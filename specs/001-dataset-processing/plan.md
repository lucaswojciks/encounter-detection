# Plano técnico 001 — Processamento de datasets

- **Status:** Implementado
- **Spec:** [`spec.md`](spec.md)

Alternativas de desempenho são apenas candidatas. Qualquer troca depende de
benchmark (spec 003).

> **Atualização:** as seções 1 a 11 descrevem a primeira implementação, com
> `readline`, que continua no código como referência (`readDatasetLines`). Desde a
> spec, seção 12, `readDataset` lê o arquivo em blocos de bytes e converte os
> registros canônicos sem passar por strings; ver a seção 12 deste plano.

## 1. Visão geral

```
arquivo ──► leitor de linhas (I/O) ──► agrupador por timestamp (puro) ──► consumidor
            node:fs + node:readline     parseRecord + ordem               (spec 002)
            AsyncIterable<string>       AsyncGenerator<TimestampGroup>
```

O código tem duas camadas:

1. **Domínio, sem I/O:** conversão de linha em registro e agrupamento. Recebe um
   `Iterable<string>` ou `AsyncIterable<string>`; os testes alimentam arrays de linhas.
2. **Adaptador de arquivo:** abre o arquivo e entrega as linhas. É a única parte que
   toca o disco.

## 2. Estrutura de arquivos

```
src/dataset/
├── types.ts               # LocationRecord, TimestampGroup
├── dataset-error.ts       # DatasetError
├── parse-record.ts        # parseRecord(line, lineNumber, source): LocationRecord
├── group-by-timestamp.ts  # TimestampGrouper; groupByTimestamp(lines, source): AsyncGenerator<TimestampGroup>
├── parse-record-bytes.ts  # RecordBytesParser: caminho rápido da conversão (seção 12)
├── chunk-parser.ts        # DatasetChunkParser: blocos de bytes → linhas → grupos (seção 12)
└── read-dataset.ts        # readDataset(path) (bytes) e readDatasetLines(path) (readline, referência)
test/dataset/              # testes unitários e de integração
test/fixtures/official/    # datasets 1 e 2 e gabaritos oficiais (bytes originais)
scripts/
├── measure-dataset.ts     # medição diagnóstica (CA-10); --reader bytes|lines
└── compare-readers.ts     # equivalência entre readDataset e readDatasetLines (CA-16)
```

Sem camadas adicionais (repositórios, fábricas, injeção de dependências).

## 3. Representação tipada

```ts
export interface LocationRecord {
  readonly id: number;
  readonly faction: number | null;           // null = sem facção
  readonly timestamp: string;                // texto do input sem as aspas
  readonly latitude: number;
  readonly longitude: number;
  readonly hasProtectiveMeasure: boolean;
  readonly restrictedIds: readonly number[]; // [] quando vazio
}

export interface TimestampGroup {
  readonly timestamp: string;
  readonly records: readonly LocationRecord[];
}
```

| Escolha | Alternativa | Motivo |
| ------- | ----------- | ------ |
| `faction: number \| null` | `string`, ou `""` para vazio | A ausência fica explícita, e o modo `strict` obriga o tratamento. As facções são inteiras em todos os dados. |
| `timestamp: string` | `Date` ou epoch | Os timestamps são preservados exatamente como no input; a igualdade é textual e a saída repete o texto. |
| `restrictedIds: number[]` | `Set<number>` | As listas são curtas; a estrutura de busca, se necessária, é decisão da spec 002. |
| Nomes em inglês | Nomes do arquivo (`idMonitorado`) | Segue a convenção do código. O mapeamento para a saída fica na spec 004. |

## 4. Leitura incremental

| Opção | Prós | Contras |
| ----- | ---- | ------- |
| **A. `fs.createReadStream` + `readline` com `for await`** | Nativo; trata CRLF (`crlfDelay: Infinity`), última linha sem `\n` e UTF-8 dividido entre chunks; contrapressão pelo próprio `for await`. | Custo do iterador assíncrono por linha (medido na seção 10). |
| B. `readline` com evento `'line'` | Em geral mais rápido. | Sem contrapressão para um consumidor assíncrono, a não ser com `pause/resume` manual. |
| C. Divisão manual de chunks (`Buffer.indexOf`) | Potencialmente o mais rápido. | Mais código (linhas entre chunks, CRLF, BOM, UTF-8). Otimização prematura agora. |
| D. `fs.readFile` + `split` | Trivial. | Carrega até 638 MB em memória (viola RP-01). **Descartada.** |

**Decisão: opção A.** A opção C fica como candidata para a spec 003, condicionada a
benchmark e aos mesmos testes.

- `createReadStream(path, { encoding: 'utf8' })`, `highWaterMark` padrão.
- `crlfDelay: Infinity`. Um `\r` final remanescente também é removido pelo agrupador,
  para que fontes que não sejam o `readline` tenham o mesmo comportamento.
- O BOM (`﻿`) é removido apenas da primeira linha.
- Erros de abertura ou leitura (`ENOENT`, `EACCES`, `EISDIR`) são convertidos em
  `DatasetError` com o caminho do arquivo.

## 5. Parsing dos campos

`line.split(';')` seguido de `length === 7`. A varredura manual com `indexOf` fica
para a spec 003, com benchmark.

`Number()`, `parseInt` e `parseFloat` aceitam formas que não são números decimais
(`Number('') === 0`, `Number(' 1 ') === 1`, `Number('0x10') === 16`,
`parseInt('12abc') === 12`). Por isso cada campo numérico é **verificado por
expressão regular antes da conversão**. As expressões apenas rejeitam texto que não
pode ser convertido; não alteram valores aceitos.

| Campo | Aceito | Conversão |
| ----- | ------ | --------- |
| id, facção, ids da lista | `^[0-9]+$` e `Number.isSafeInteger` | `Number(s)` |
| timestamp | aspas delimitadoras opcionais; conteúdo `^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$` | `slice(1, -1)` quando há aspas; senão, o próprio texto |
| latitude, longitude | `^[-+]?[0-9]+(\.[0-9]+)?$`, em [−90, 90] / [−180, 180] | `Number(s)` |
| medidaProtetiva | `'true'` / `'false'` | booleano |
| lista de restrição | aspas delimitadoras opcionais; itens separados por `,`, cada um como id | `split(',').map(Number)` |

`Number(s)` sobre texto decimal é a conversão IEEE-754 com arredondamento correto, o
mesmo valor obtido por `JSON.parse` do gabarito (ver análise, seção 3.3).

## 6. Agrupamento temporal

`groupByTimestamp(lines, source)` é um `async function*` que:

1. Lê a primeira linha, remove o BOM e valida o cabeçalho (E-02, E-03).
2. Para cada linha seguinte: remove o `\r` final; ignora se vazia; senão converte com
   `parseRecord`.
3. Se o timestamp é igual ao do grupo corrente, acumula o registro.
4. Se é maior, emite (`yield`) o grupo corrente e inicia outro com um **novo** array.
5. Se é menor, lança E-06.
6. Ao fim das linhas, emite o grupo pendente, se houver.

- O `yield` só retorna quando o consumidor pede o próximo grupo, o que propaga a
  contrapressão até o `readline` (RF-05).
- Basta comparar com o timestamp anterior (RP-03); não é preciso guardar os
  timestamps já vistos.
- Contagens de registros e grupos são obtidas pelo consumidor, se necessário; o
  gerador não mantém estatísticas.

## 7. Controle de memória

| Estrutura | Tamanho máximo |
| --------- | -------------- |
| Buffer do stream | `highWaterMark` (64 KiB) |
| Linha corrente | Uma linha (≈53 bytes) |
| Grupo corrente | Registros de um timestamp (120 no dataset 7) |
| Estado global | Timestamp anterior e número da linha |

A memória retida é **O(maior grupo)**. Limitação: um arquivo com um único timestamp
gigante reteria o grupo inteiro, o que é inerente ao contrato de entregar grupos
completos. Não ocorre nos dados oficiais.

## 8. Tratamento de erros

```ts
class DatasetError extends Error {
  readonly source: string | undefined;     // caminho do arquivo
  readonly lineNumber: number | undefined;
  readonly field: string | undefined;
}
```

- Uma única classe; a mensagem segue o formato
  `<arquivo>:<linha>: field "<campo>": <motivo>`, omitindo as partes ausentes.
  Exemplo: `data/dataset1.txt:1532: field "latitude": "91.0" is outside [-90, 90]`.
- **Fail-fast** (D1): o primeiro erro é lançado pelo gerador e recebido pelo
  `for await` do consumidor.
- O `finally` do adaptador fecha o `readline` e destrói o stream em qualquer término:
  fim normal, erro ou `break` do consumidor.
- A camada de CLI (spec 004) converte `DatasetError` em mensagem no `stderr` e código
  de saída diferente de zero.

## 9. Integração com o detector (spec 002)

```ts
for await (const group of readDataset(path)) {
  for (const encounter of detectEncounters(group)) {
    writer.write(encounter);
  }
}
```

O detector recebe um `TimestampGroup` por vez. Como a regra de negócio compara apenas
timestamps idênticos, nenhum estado precisa atravessar grupos.

## 10. Estratégia de testes e medição

| Nível | Alvo | Dados |
| ----- | ---- | ----- |
| Unitário | `parseRecord`: cada campo aceito/rejeitado (CA-07) | Strings inline |
| Unitário | `groupByTimestamp`: agrupamento, último grupo, só cabeçalho, linhas vazias, CRLF, BOM, E-02 a E-06 (CA-05, CA-06, CA-08) | Arrays de linhas |
| Unitário | Contrapressão e encerramento da fonte (CA-09) | Fonte de linhas instrumentada |
| Integração | `readDataset`: arquivos temporários LF/CRLF/BOM, erro com caminho e linha, arquivo vazio, arquivo inexistente | Arquivos gerados no diretório temporário do SO |
| Aceitação | Datasets oficiais 1 e 2 (CA-01 a CA-04) | `test/fixtures/official/` |
| Diagnóstico | Tempo, registros, grupos e memória (CA-10) | `data/` local, não versionado |

**Fixtures oficiais:** `dataset1.txt`, `dataset2.txt`, `respostas1.json` e
`respostas2.json` (≈1,5 MB) são versionados sem modificação em
`test/fixtures/official/`, marcados como `-text` no `.gitattributes` para que o Git
não converta as quebras de linha no checkout (`core.autocrlf`). Os datasets 3 a 7 não
são versionados.

**Referência independente (CA-03):** o teste de aceitação lê o fixture com
`readFileSync` + `split` e compara cada campo de cada registro com o resultado do
leitor em streaming.

### Resultados da medição

Medição **diagnóstica** (não é benchmark nem limite). Executada em 2026-11-02, com
Node.js 24.19.0, Windows 11 Pro, AMD Ryzen 5 5600X, 16 GB de RAM e SSD. Cada linha
corresponde a um processo separado, lendo `data/` com o build de produção:

```
npm run build
node dist/scripts/measure-dataset.js data/datasetN.txt
node --expose-gc dist/scripts/measure-dataset.js data/datasetN.txt   # heap retido
```

O consumidor apenas conta registros e grupos, então o tempo inclui leitura, parsing,
validação e agrupamento, sem detecção.

| Dataset | Tamanho | Registros | Grupos | Maior grupo | Tempo | Registros/s | Pico de heap | RSS máximo |
| ------- | ------: | --------: | -----: | ----------: | ----: | ----------: | -----------: | ---------: |
| 1 | 0,2 MiB | 5 000 | 500 | 10 | 0,013 s | ≈385 mil | 5,3 MiB | 41,9 MiB |
| 2 | 1,2 MiB | 25 000 | 1 250 | 20 | 0,037 s | ≈670 mil | 6,8 MiB | 47,1 MiB |
| 3 | 5,0 MiB | 100 000 | 2 500 | 40 | 0,106 s | ≈945 mil | 8,8 MiB | 50,8 MiB |
| 4 | 20,1 MiB | 400 020 | 6 667 | 60 | 0,370 s | ≈1,08 milhão | 9,8 MiB | 58,9 MiB |
| 5 | 50,4 MiB | 1 000 000 | 12 500 | 80 | 0,880–0,895 s (3 execuções) | ≈1,12–1,14 milhão | 12,4–13,3 MiB | 59,5–60,1 MiB |

Heap **retido** (amostrado após `gc()` a cada 1 000 grupos, com `--expose-gc`):

| Dataset | Registros | Heap antes da leitura | Pico de heap retido |
| ------- | --------: | --------------------: | ------------------: |
| 3 | 100 000 | 4,5 MiB | 4,9 MiB |
| 5 | 1 000 000 | 4,5 MiB | 5,1 MiB |

Leitura dos resultados:

- As contagens de registros, grupos e maior grupo são iguais às da análise
  exploratória para os cinco datasets.
- O heap retido praticamente não muda entre 100 mil e 1 milhão de registros. O pico de
  heap sem coleta forçada inclui lixo ainda não coletado e por isso varia mais. Isso é
  coerente com RP-01/RP-02: o arquivo não é mantido em memória.
- O RSS máximo inclui o runtime do Node e os buffers do stream.
- Os datasets 6 e 7 não estavam disponíveis localmente e não foram medidos. Uma
  extrapolação linear do throughput não substitui a medição.

## 11. Notas de implementação

- `DatasetError` também expõe `reason`, o motivo sem o prefixo de localização, para
  uso por camadas que formatam a mensagem de outra forma.
- `parse-record.ts` exporta `HEADER` e `FIELD_NAMES`, usados pelo agrupador e pelos
  testes. As funções de conversão de cada campo são privadas, e os testes passam por
  `parseRecord`.
- Os nomes de campo nas mensagens de erro são os do arquivo de entrada
  (`idMonitorado`, `latitude` etc.), para que o usuário os localize no arquivo.
- O `finally` de `readDataset` aguarda o evento `close` do stream, porque `destroy()`
  libera o descritor de forma assíncrona.
- **Teste removido:** um teste que apagava o arquivo logo após um `break`, para provar
  que ele havia sido fechado, passava mesmo sem fechar o stream. No Windows, o libuv
  abre arquivos com `FILE_SHARE_DELETE`. O teste foi removido para não dar falsa
  garantia. O encerramento da fonte de linhas é coberto pelo teste de contrapressão
  do agrupador. Com o leitor por bytes (seção 12), o fechamento do arquivo passou a
  ter um teste direto (CA-15).

## 12. Leitura a partir de bytes (spec, seção 12)

### 12.1 Visão geral

```
arquivo ──► readDataset ──────► DatasetChunkParser ─────────► TimestampGrouper ──► consumidor
            FileHandle.read     blocos → linhas (LF/CRLF/CR)  cabeçalho, ordem,
            blocos de 1 MiB     linha canônica → RecordBytesParser   grupos
                                outra linha → texto → parseRecord
```

- `RecordBytesParser` (`parse-record-bytes.ts`) converte uma linha direto dos
  bytes, ou devolve `undefined` para que ela siga o caminho de texto.
- `DatasetChunkParser` (`chunk-parser.ts`) divide os blocos em linhas e entrega
  registros ou texto ao `TimestampGrouper`. Não faz I/O e é testado com blocos de
  qualquer tamanho.
- `TimestampGrouper` (`group-by-timestamp.ts`) tem o estado que antes ficava dentro
  de `groupByTimestamp`: número da linha, cabeçalho, grupo corrente e verificação de
  ordem (E-06). As duas leituras usam o mesmo código para essas regras.
- `readDataset` só lê o arquivo e converte erros de sistema em `DatasetError`.

### 12.2 Caminho rápido da conversão

Subconjunto aceito, no qual o resultado é o mesmo de `parseRecord`:

| Campo | Aceito pelo caminho rápido | Fora dele (vai para `parseRecord`) |
| ----- | -------------------------- | ---------------------------------- |
| id, facção | 1 a 15 dígitos (facção também vazia) | 16 ou mais dígitos, sinal, espaço, vazio no id |
| timestamp | `YYYY-MM-DD HH:MM:SS` com ou sem aspas | qualquer outro texto |
| latitude, longitude | sinal opcional, ≥ 1 dígito, ponto opcional seguido de ≥ 1 dígito, **15 dígitos no total**, dentro de ±90 / ±180 | mais de 15 dígitos, `5.`, `.5`, expoente, vírgula, fora do intervalo |
| medidaProtetiva | `true`, `false` | qualquer outro texto |
| lista de restrição | vazia, ou ids de 1 a 15 dígitos separados por `,`, com ou sem aspas | ids vazios, aspas desbalanceadas, espaços, ids de 16 dígitos |
| linha | exatamente 7 campos, só ASCII, sem `CR` (além do `CR` final do `CRLF`) | qualquer outra |

- **Inteiros.** Até 15 dígitos, o valor é menor que 2⁵³ e o acumulador
  `v·10 + d` é exato a cada passo. É o mesmo valor de `Number(s)`, e não é preciso
  verificar `Number.isSafeInteger`.
- **Coordenadas.** Com `m` o inteiro formado pelos dígitos (até 15, exato) e `k` o
  número de decimais, o valor é `m / 10^k`. Os dois operandos são `double` exatos
  (`10^k` é exato até `k = 22`), e a divisão IEEE 754 é corretamente arredondada:
  o resultado é o `double` mais próximo de `m·10⁻ᵏ`, o mesmo que `Number(s)`
  devolve. O sinal é aplicado depois (`−0` para `-0.0`, como em `Number`). O teste de
  intervalo é o mesmo de `parseRecord`.
- **Timestamp.** Os 19 bytes são comparados com os do timestamp anterior. Se forem
  iguais (o caso comum: 120 linhas por grupo no dataset 7), a string anterior é
  reutilizada, sem validar nem decodificar de novo. Caso contrário, os bytes são
  validados e uma nova string é criada.
- **Erros.** O caminho rápido nunca lança erro. Toda linha inválida é recusada por
  ele e chega a `parseRecord`, que produz a mesma mensagem de antes. Não há uma
  segunda versão das regras de validação.

### 12.3 Divisão em linhas

- As linhas são separadas no `LF`, encontrado com `Buffer.indexOf` (nativo).
- O caminho rápido recebe a linha sem o `CR` final do `CRLF`.
- O caminho lento decodifica a linha (UTF-8) e a divide em cada `CR`, descartando o
  último trecho vazio. Isso reproduz a divisão do `readline` com
  `crlfDelay: Infinity` (`\r\n`, `\n` ou `\r` isolado), inclusive a numeração das
  linhas.
- O cabeçalho (linha 1) sempre segue o caminho lento, que remove o BOM e valida o
  texto.
- Uma linha que termina em outro bloco é guardada como **cópia** dos seus bytes: o
  buffer de leitura é reutilizado. Ela é concatenada com o início do bloco seguinte.
  Ao fim do arquivo, a linha pendente (sem terminação) é processada.
- Os grupos de um bloco são entregues por um gerador síncrono (`push`), sem acumular
  uma lista. Um erro no meio do bloco interrompe a iteração naquela linha, depois de
  entregues os grupos anteriores. O laço por linha está escrito inline, porque
  `yield*` criaria um gerador por linha.

### 12.4 Leitura do arquivo

| Opção | Prós | Contras | Decisão |
| ----- | ---- | ------- | ------- |
| `createReadStream` + `for await` dos blocos | API de streams | Ao sair do laço por erro, o iterador do stream o destrói com `AbortError`, e esperar o evento `close` rejeitava com esse erro, substituindo o `DatasetError`. Encontrado pelos testes de erro e de interrupção. | Rejeitada |
| **`FileHandle.read` num buffer reutilizado** | O próximo bloco só é lido quando o consumidor pede um grupo (RB-07); fechamento explícito com `close()` no `finally`; um único buffer | Sem leitura antecipada em paralelo com o processamento | **Adotada** |

- **Tamanho do bloco: 1 MiB.** Numa medição exploratória com a CLI (2 execuções por
  tamanho), os datasets 6 e 7 levaram 2,47 s e 3,69–3,87 s com 64 KiB, 2,33–2,86 s e
  3,41–3,50 s com 256 KiB e 2,22 s e 3,27–3,31 s com 1 MiB. No dataset 3 não houve
  diferença (0,05 s). O benchmark da seção 12.6 usa 1 MiB.
- **Memória:** um buffer de 1 MiB, a linha pendente, os bytes do último timestamp e
  o grupo corrente. Continua `O(maior grupo)` (RP-02).
- **Erros de sistema** (`ENOENT`, `EISDIR`, `EACCES`) são convertidos em
  `DatasetError`, com a mesma mensagem da leitura por stream (`cannot read file:
  ENOENT: no such file or directory, open '…'`).

### 12.5 Validação

| Verificação | Resultado |
| ----------- | --------- |
| CA-11 e CA-12: 11 linhas canônicas iguais a `parseRecord`; 46 linhas recusadas pelo caminho rápido, 3 delas válidas para `parseRecord` | Passa |
| CA-13: 200 000 pares de coordenadas aleatórias; 100 000 linhas aleatórias com até 3 mutações | Coordenadas iguais bit a bit a `Number()`; nenhuma linha aceita com registro diferente do de `parseRecord` |
| CA-14: 28 conteúdos (12 variações de terminação, BOM e linhas vazias; linhas válidas não canônicas; 12 erros e 2 arquivos só com cabeçalho; UTF-8 inválido) com blocos de 1 byte até o arquivo inteiro | Mesmos grupos, registros, mensagens, linhas e campos que `readline` + `groupByTimestamp` |
| `readDataset` num arquivo de 3,3 MiB com CRLF (mais de 2 blocos) | Igual a `readDatasetLines` |
| CA-15: fechamento no fim, em erro e em `break` | Os 3 `FileHandle` terminam com `fd = -1` |
| CA-16: `compare-readers` nos datasets 1 a 7 | Idênticos em 500, 1 250, 2 500, 6 667, 12 500, 80 000 e 100 000 grupos, num total de **21 530 020 registros** |

Mutantes (alteração temporária do código compilado, uma por vez, com os testes de
leitura):

| Mutação | Testes que falham |
| ------- | ----------------: |
| Inteiros de até 16 dígitos | 3 |
| Decimais por multiplicação (`m · 10⁻ᵏ`) | 6 |
| Timestamp anterior sempre reutilizado | 10 |
| Sem teste de intervalo | 4 |
| Aspas finais da lista não exigidas | 2 |
| `CR` isolado não encerra linha | 2 |
| Linha pendente sem cópia | 2 |
| Linha pendente descartada no fim | 6 |
| Arquivo não fechado | 1 |
| `CR` do `CRLF` mantido no caminho rápido | 0: mutação equivalente. A linha é recusada pelo caminho rápido e convertida corretamente pelo lento; só o desempenho muda |

### 12.6 Resultados (CA-17)

Executado em 2026-11-02 com Node.js 24.19.0, Windows 11 Pro, AMD Ryzen 5 5600X,
16 GB de RAM e SSD, com os arquivos já no cache do sistema operacional. **Anterior**
é o build da `main` (`3a521f6`, leitura com `readline`), compilado num worktree
temporário. **Otimizada** é o build desta branch. São 5 rodadas, cada medição num
processo separado, alternando a ordem das versões a cada rodada:

```
node dist/scripts/measure-dataset.js data/datasetN.txt
```

Leitura, parsing, validação e agrupamento, sem detecção. Valores: **mediana
[mínimo–máximo]**, em segundos.

| Dataset | Anterior | Otimizada | Redução | Fator |
| ------- | -------- | --------- | ------: | ----: |
| 1 | 0,013 [0,012–0,014] | 0,007 [0,007–0,008] | 46 % | 1,9× |
| 2 | 0,038 [0,036–0,042] | 0,018 [0,016–0,019] | 53 % | 2,1× |
| 3 | 0,114 [0,111–0,175] | 0,042 [0,039–0,073] | 63 % | 2,7× |
| 4 | 0,402 [0,383–0,410] | 0,108 [0,104–0,130] | 73 % | 3,7× |
| 5 | 0,994 [0,954–1,451] | 0,270 [0,251–0,299] | 73 % | 3,7× |
| 6 | 8,037 [7,753–8,774] | 1,812 [1,789–2,385] | 77 % | 4,4× |
| 7 | 11,848 [11,488–12,092] | 2,715 [2,588–2,894] | 77 % | 4,4× |
| **Soma das medianas** | **21,446** | **4,972** | **77 %** | **4,3×** |

Memória (mediana das 5 execuções):

| Dataset | Pico de heap, anterior | Pico de heap, otimizada | RSS máximo, anterior | RSS máximo, otimizada |
| ------- | ---------------------: | ----------------------: | -------------------: | --------------------: |
| 1 | 6,5 MiB | 5,2 MiB | 46,2 MiB | 45,8 MiB |
| 3 | 8,9 MiB | 6,1 MiB | 52,6 MiB | 47,8 MiB |
| 5 | 13,0 MiB | 8,0 MiB | 60,8 MiB | 51,8 MiB |
| 6 | 32,4 MiB | 13,2 MiB | 100,9 MiB | 61,7 MiB |
| 7 | 32,3 MiB | 12,9 MiB | 103,1 MiB | 61,7 MiB |

- Em todos os datasets, a pior execução da versão otimizada foi mais rápida que a
  melhor da anterior.
- O ganho cresce com o arquivo: nos datasets pequenos, o custo fixo (abrir o arquivo,
  compilar o código) pesa mais.
- A memória **cai**: sem uma string, um array de campos e um resultado de expressão
  regular por linha, sobra menos lixo entre coletas. O buffer de 1 MiB não aparece
  como aumento.
- O cache frio do disco não foi medido. Com o arquivo fora do cache, a leitura física
  (≈0,5 s para os 609 MiB do dataset 7 com o cache quente) pode passar a pesar mais.

### 12.7 Riscos e limitações

- **Dois caminhos de conversão.** O caminho rápido precisa continuar sendo um
  subconjunto exato de `parseRecord`. Uma mudança nas regras da seção 4.2 exige
  revisar `RecordBytesParser`. Os testes diferenciais (CA-13 e CA-14) cobrem os casos
  gerados, não todos os casos possíveis.
- **`CR` isolado** continua encerrando linha, como no `readline`. É um comportamento
  herdado, não exigido pelo enunciado, mantido para não mudar resultados.
- **UTF-8 inválido** só aparece em linhas recusadas pelo caminho rápido (que aceita
  apenas ASCII) e é decodificado como antes. O teste cobre uma sequência truncada.
- **Linhas muito longas** são acumuladas até o próximo `LF`, como no `readline`. Não há
  limite de tamanho de linha.

# Plano técnico 001 — Processamento de datasets

- **Status:** Implementado
- **Spec:** [`spec.md`](spec.md)

Alternativas de desempenho são apenas candidatas. Qualquer troca depende de
benchmark (spec 003).

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
├── group-by-timestamp.ts  # groupByTimestamp(lines, source): AsyncGenerator<TimestampGroup>
└── read-dataset.ts        # readDataset(path): AsyncGenerator<TimestampGroup>
test/dataset/              # testes unitários e de integração
test/fixtures/official/    # datasets 1 e 2 e gabaritos oficiais (bytes originais)
scripts/
└── measure-dataset.ts     # medição diagnóstica (CA-10)
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
  do agrupador.

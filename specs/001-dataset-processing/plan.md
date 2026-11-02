# Plano técnico 001 — Processamento de datasets

- **Status:** Em revisão
- **Spec:** [`spec.md`](spec.md)

Este documento propõe **como** atender a spec. Nada aqui foi implementado.
Alternativas de desempenho são apenas candidatas: qualquer troca depende de benchmark
(spec 003).

## 1. Visão geral

```
arquivo ──► leitor de linhas (I/O) ──► agrupador por timestamp (puro) ──► consumidor
            node:fs + node:readline     parseRecord + validações          (spec 002)
            AsyncIterable<string>       AsyncGenerator<TimestampGroup>
```

O código é dividido em duas camadas:

1. **Domínio, sem I/O:** conversão de linha em registro e agrupamento. Recebe um
   `AsyncIterable<string>` (ou `Iterable<string>`), de modo que os testes alimentam
   arrays de linhas diretamente.
2. **Adaptador de arquivo:** abre o arquivo e entrega as linhas. É a única parte que
   toca o disco.

## 2. Estrutura de arquivos prevista

```
src/dataset/
├── types.ts               # LocationRecord, TimestampGroup, DatasetStats
├── errors.ts              # DatasetError
├── parse-record.ts        # parseRecord(line, lineNumber): LocationRecord
├── group-by-timestamp.ts  # groupByTimestamp(lines): AsyncGenerator<TimestampGroup>
└── read-dataset.ts        # readDataset(path): AsyncGenerator<TimestampGroup>
test/dataset/
├── parse-record.test.ts
├── group-by-timestamp.test.ts
├── read-dataset.test.ts
└── fixtures/              # arquivos pequenos, escritos à mão
```

A pasta `src/dataset/` agrupa o que pertence a esta funcionalidade, sem camadas
adicionais (repositórios, fábricas, injeção de dependências).

## 3. Representação tipada

```ts
export interface LocationRecord {
  readonly id: number;
  readonly faction: number | null;          // null = sem facção
  readonly timestamp: string;               // "YYYY-MM-DD HH:MM:SS", sem aspas
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

Decisões:

| Escolha | Alternativa | Motivo |
| ------- | ----------- | ------ |
| `faction: number \| null` | `string`, ou `""` para vazio | `null` torna a ausência explícita, e com `strict` o compilador obriga o tratamento. Facções são inteiras em todos os dados. |
| `timestamp: string` | `Date` ou epoch `number` | O timestamp é chave de igualdade e sai igual no JSON. Não ter fuso evita conversões ambíguas. Com largura fixa, a comparação lexicográfica é cronológica. |
| `restrictedIds: number[]` | `Set<number>` | Listas observadas têm 1 elemento; um array é menor e mais simples. A busca é feita pela spec 002. |
| Nomes em inglês | Nomes do arquivo (`idMonitorado`) | Segue a convenção do código. O mapeamento para os nomes da saída fica na spec 004. |

## 4. Leitura incremental

### 4.1 Alternativas

| Opção | Prós | Contras |
| ----- | ---- | ------- |
| **A. `fs.createReadStream` + `readline.createInterface` com `for await`** | Nativo; trata CRLF (`crlfDelay: Infinity`), última linha sem `\n` e UTF-8 dividido entre chunks; contrapressão automática com `for await`. | O iterador assíncrono tem custo por linha; o desempenho precisa ser medido. |
| B. `readline` com evento `'line'` | Geralmente mais rápido que `for await`. | Sem contrapressão: o consumidor assíncrono (spec 002) não pausa a leitura sem `pause/resume` manual, o que é propenso a erro. |
| C. Divisão manual de chunks (`Buffer.indexOf(10)`) | Potencialmente o mais rápido; permite parsing sem criar strings intermediárias. | Mais código: linhas cortadas entre chunks, CRLF, BOM e UTF-8. Otimização prematura agora. |
| D. `fs.readFile` + `split('\n')` | Trivial. | Viola RP-01: carrega até 638 MB em memória. **Descartada.** |

### 4.2 Decisão

**Opção A.** Atende todos os requisitos com APIs nativas e pouco código. A opção C é
candidata para a spec 003, desde que um benchmark mostre ganho e os mesmos testes
passem.

Detalhes:

- `createReadStream(path, { encoding: 'utf8' })`: o decodificador de stream trata
  caracteres multibyte divididos entre chunks. O `highWaterMark` padrão (64 KiB) é
  mantido até haver medição.
- `crlfDelay: Infinity` faz `\r\n` contar como uma quebra só. Em seguida, remove-se um
  eventual `\r` final remanescente.
- O BOM (`﻿`) é removido apenas da primeira linha.
- Erros de abertura (`ENOENT`, `EACCES`) são propagados como `DatasetError` com o
  caminho do arquivo.

## 5. Parsing dos campos

### 5.1 Divisão da linha

`line.split(';')` seguido da verificação `length === 7`. Alternativa: varredura com
`indexOf`, sem criar o array. Esta fica para a spec 003, com benchmark.

### 5.2 Validação e conversão

`Number()`, `parseInt` e `parseFloat` aceitam formas que a spec rejeita
(`Number('') === 0`, `Number(' 1 ') === 1`, `Number('0x10') === 16`,
`parseInt('12abc') === 12`). Por isso cada campo é **validado por expressão regular
antes da conversão**:

| Campo | Expressão | Conversão | Verificação adicional |
| ----- | --------- | --------- | --------------------- |
| id, facção, ids da lista | `^[1-9][0-9]*$` | `Number(s)` | `Number.isSafeInteger` |
| timestamp | `^"([0-9]{4})-([0-9]{2})-([0-9]{2}) ([0-9]{2}):([0-9]{2}):([0-9]{2})"$` | `slice(1, -1)` | Data válida no calendário (mês 1–12, dia conforme mês/ano bissexto, hora 0–23, minuto/segundo 0–59), verificada por aritmética inteira, sem `Date`, para não depender de fuso. |
| latitude, longitude | `^-?[0-9]+\.[0-9]+$` | `Number(s)` | Intervalos [−90, 90] e [−180, 180] |
| medidaProtetiva | comparação direta com `'true'` / `'false'` | booleano | — |
| lista de restrição | `^"[1-9][0-9]*(,[1-9][0-9]*)*"$` | `slice(1, -1).split(',').map(Number)` | `Number.isSafeInteger` |

As expressões são compiladas uma vez, no carregamento do módulo. Os campos vazios
(facção e lista) são verificados com `=== ''` antes da expressão.

`Number(s)` sobre texto decimal válido é a conversão IEEE-754 com arredondamento
correto. É o mesmo valor obtido por `JSON.parse` do gabarito, o que mantém a
compatibilidade numérica de `posicoes` e da distância (ver análise, seção 3.3).

## 6. Agrupamento temporal

`groupByTimestamp(lines)` é um `async function*` que:

1. Lê a primeira linha e valida o cabeçalho (RI-01, RI-02).
2. Para cada linha seguinte: ignora se vazia; senão chama `parseRecord`.
3. Se `record.timestamp === current`, verifica o id duplicado (RI-07, com um `Set`
   do grupo corrente) e acumula o registro.
4. Se for diferente: exige `record.timestamp > current` (RI-05/RI-06), emite
   (`yield`) o grupo corrente e inicia outro.
5. Ao fim das linhas, emite o grupo pendente, se existir.

Propriedades:

- O `yield` só retorna quando o consumidor pede o próximo grupo, o que garante a
  contrapressão de RF-05 até o `readline`.
- Para RI-06 basta comparar com o timestamp **anterior**: com largura fixa e ordem
  não decrescente, um timestamp repetido após outro grupo é necessariamente menor
  que o anterior. Não é preciso guardar todos os timestamps vistos (RP-03).
- O array do grupo emitido não é reutilizado: um array novo é criado por grupo, e o
  consumidor pode retê-lo com segurança.

## 7. Controle de memória

| Estrutura | Tamanho máximo |
| --------- | -------------- |
| Buffer do stream | `highWaterMark` (64 KiB) |
| Linha corrente | Tamanho de uma linha (≈53 bytes) |
| Grupo corrente (registros + `Set` de ids) | Indivíduos por timestamp (120 no dataset 7) |
| Estado global | Timestamp anterior, número da linha, contadores |

A memória é **O(maior grupo)**, independente do tamanho do arquivo. Isso será
verificado pelo CA-11 (heap limitado), que é mais confiável que medições pontuais de
`process.memoryUsage()`.

Risco: um arquivo com um único timestamp gigante (milhões de registros num só grupo)
reteria o grupo inteiro. É inerente ao contrato de entregar grupos completos. Não
ocorre nos dados oficiais; fica registrado como limitação.

## 8. Tratamento de erros

```ts
export class DatasetError extends Error {
  readonly lineNumber: number | undefined;
  readonly field: string | undefined;
}
```

- Uma única classe; o motivo vai na mensagem, por exemplo
  `Line 1532, field "latitude": value "91.00000" is outside [-90, 90]`.
- Política **fail-fast** (decisão D1 da spec): o primeiro erro é lançado pelo gerador
  e o `for await` do consumidor o recebe.
- Ao lançar, o gerador encerra o iterador do `readline`, que fecha o stream. O teste
  verifica que o descritor de arquivo é liberado.
- A camada de CLI (spec 004) converte `DatasetError` em mensagem no `stderr` e código
  de saída ≠ 0.

Alternativa considerada: acumular erros e continuar. Ela foi rejeitada por padrão
porque produziria encontros a partir de dados parcialmente inválidos, sem que o
resultado indicasse isso. Pode virar uma opção explícita no futuro, se aprovada.

## 9. Integração futura com o detector (spec 002)

```ts
for await (const group of readDataset(path)) {
  for (const encounter of detectEncounters(group)) {
    writer.write(encounter);
  }
}
```

- O detector recebe um `TimestampGroup` por vez. Como a regra de negócio compara apenas
  timestamps idênticos, nenhum estado precisa atravessar grupos.
- Os ids já estão validados como únicos por grupo, então o detector não precisa
  tratar o mesmo indivíduo duas vezes no mesmo timestamp.
- Estatísticas (RF-06) ficam num objeto `DatasetStats` atualizado pelo gerador. A
  forma exata (retorno do gerador ou callback) será decidida na implementação, com
  preferência pelo mais simples de testar.

## 10. Estratégia de testes

Todos os testes usam `node:test` e `node:assert/strict`, compilados por `tsc` (setup
já existente).

| Nível | Alvo | Fonte de dados |
| ----- | ---- | -------------- |
| Unitário | `parseRecord`: cada campo válido/inválido e os limites (CA-07) | Strings inline |
| Unitário | `groupByTimestamp`: agrupamento, ordem, último grupo, arquivo só com cabeçalho, linhas vazias, RI-01 a RI-09 (CA-06, CA-08) | Arrays de linhas inline |
| Unitário | Contrapressão (CA-09) | Gerador de linhas que registra quantas linhas foram consumidas |
| Integração | `readDataset`: LF/CRLF, BOM, sem `\n` final (CA-05), arquivo inexistente | `test/dataset/fixtures/` (arquivos de poucas linhas) |
| Aceitação | Datasets oficiais 1 e 2 (CA-01 a CA-04) | Ver decisão abaixo |
| Manual | Datasets 3–5 e heap limitado (CA-10, CA-11) | `data/` local, não versionado |

**Decisão a aprovar — fixtures oficiais:** versionar `dataset1.txt` (255 KB),
`dataset2.txt` (1,3 MB), `respostas1.json` e `respostas2.json` em
`test/fixtures/official/`. Isso torna os testes de aceitação reprodutíveis sem rede.
A alternativa é baixá-los num passo de preparação, o que torna os testes dependentes
de rede e do bucket. Datasets 3–7 nunca são versionados.

Testes de memória automatizados (medição de heap em CI) não foram incluídos, por
serem instáveis. O CA-11 cobre o requisito com um limite rígido.

## 11. Riscos e limitações

- O desempenho de `readline` + `for await` em 12 M de linhas é desconhecido; será
  medido antes de qualquer otimização.
- A validação por expressão regular tem custo por campo; o benefício (rejeitar
  `0x10`, `1e3` e vazios) é considerado mais importante até haver medição.
- A spec rejeita formatos não observados (sem aspas, com espaços). Se o avaliador usar
  datasets com variações, as regras da seção 3.2 da spec precisarão ser revistas.

# Plano técnico 004 — Saída e validação

- **Status:** Em implementação
- **Spec:** [`spec.md`](spec.md)

## 1. Arquitetura

```
src/cli.ts                 entrada do executável: argumentos → processDataset → resumo / erro
src/cli/arguments.ts       parseArguments(argv): opções ou erro de uso
src/process-dataset.ts     readDataset → detectDatasetEncounters(search) → toOutputEncounter → writeJsonArray
src/output/json-writer.ts  writeJsonArray(items, path): escrita incremental e publicação atômica
scripts/validate-output.ts validador independente dos outputs (VAL-02)
scripts/compare-strategies.ts  equivalência entre estratégias, com amostragem (VAL-03)
```

- Cada camada tem uma responsabilidade:
  - **CLI:** argumentos, mensagens e códigos de saída.
  - **`processDataset`:** monta o fluxo e as estatísticas.
  - **Escritor:** arquivos.
  - **Detector:** regras de negócio, sem nenhuma mudança.
- `processDataset` não imprime nada e não chama `process.exit`, por isso é testável
  diretamente.

## 2. Escrita do JSON

### 2.1 Formato incremental idêntico a `JSON.stringify(lista, null, 2)`

Para uma lista não vazia, `JSON.stringify(lista, null, 2)` é:

```
"[\n  " + item₁ + ",\n  " + item₂ + … + "\n]"
```

Aqui, cada `itemₖ` é `JSON.stringify(itemₖ, null, 2)` com cada quebra de linha interna
seguida de mais dois espaços. Para a lista vazia, o resultado é `"[]"`. O escritor
reproduz exatamente essa forma, item a item, e o teste CA-03 compara o resultado com
`JSON.stringify` da lista inteira.

### 2.2 Buffer, contrapressão e atomicidade

```ts
async function writeJsonArray(items: AsyncIterable<unknown>, path: string, options?: { flushBytes?: number }): Promise<number>
```

1. Abre `"<destino>.<pid>.<aleatório>.tmp"` no **mesmo diretório** do destino com
   `fs.promises.open(…, "wx")`. Estar no mesmo diretório garante que o `rename` seja
   atômico, porque não muda de volume.
2. Acumula o texto num buffer e chama `await handle.write(buffer)` quando ele passa
   de `flushBytes` (padrão 64 KiB). O `await` dá a contrapressão: o detector só
   continua depois de o sistema operacional aceitar o bloco.
3. No fim: grava o restante, `handle.sync()`, `handle.close()` e
   `rename(temporário, destino)`.
4. Em qualquer erro (do iterável, da escrita ou do `rename`), fecha e remove o
   temporário e relança o erro. O destino só existe depois do `rename`, de modo que um
   output parcial nunca recebe o nome final.

| Alternativa | Motivo da rejeição |
| ----------- | ------------------ |
| `fs.createWriteStream` + eventos `drain` | Mais estados a tratar (`error`, `drain`, `finish`), e erros chegam por eventos. `FileHandle.write` com `await` é mais direto. |
| Acumular a lista e `JSON.stringify` no fim | Viola OUT-05. |
| Escrever direto no destino | Uma falha deixaria um arquivo parcial com o nome final (viola OUT-06). |

Memória: o buffer (≤ `flushBytes` + um encontro), e não a lista. Nos dados oficiais
os outputs são pequenos (dezenas de encontros), mas o escritor não depende disso.

### 2.3 Interrupção

A CLI trata `SIGINT` com um `AbortController`. `processDataset` verifica o sinal a
cada grupo e, quando ele é acionado, lança um erro de interrupção. O escritor então
remove o temporário, e a CLI sai com código 130.

## 3. CLI

- **Argumentos** com `util.parseArgs` (nativo do Node, modo `strict`). Opções
  desconhecidas ou valores ausentes viram erro de uso (código 2) com a mensagem de
  ajuda.
- **Saída padrão** (exemplo de formato):

  ```
  Dataset:    data/dataset1.txt
  Output:     outputs/encontros-dataset1.json
  Search:     spatialHash
  Records:    5000
  Timestamps: 500
  Encounters: 4 (generico 2, faccao 1, protetiva 1)
  Duration:   0.031 s
  Max RSS:    48.2 MiB
  ```

- **Erros:** `error: <mensagem>` na saída de erro. `DatasetError` já traz arquivo,
  linha e campo. Erros de sistema (`ENOENT`, `EISDIR`, `EACCES`) incluem o caminho.
- **Duração:** do início da leitura até a publicação do arquivo, com
  `performance.now()`. **Memória:** `process.resourceUsage().maxRSS`.

## 4. Validador independente

`scripts/validate-output.ts <output.json> [--dataset <dataset.txt>]`:

1. Lê e faz `JSON.parse` do arquivo. Os outputs são pequenos, e `JSON.parse`
   comprova que o JSON é válido.
2. Verifica cada encontro: chaves exatamente `tipo, monitoradosEncontro, timestamp,
   posicoes, distanciaMetros` nesta ordem; `tipo` válido; dois ids inteiros e
   crescentes; `posicoes` com exatamente esses dois ids e `lat`/`lon` numéricos;
   timestamp no formato da spec 001.
3. Recalcula `haversineDistance` a partir de `posicoes` e exige igualdade bit a bit
   com `distanciaMetros` e `distanciaMetros < 20`.
4. Exige (par, timestamp) únicos e a ordem do OUT-03.
5. Com `--dataset`, relê o dataset em streaming, guardando só os timestamps presentes
   no output, e exige: posições iguais às do registro do id naquele timestamp; tipo
   igual a `classifyEncounter` aplicado aos registros. O validador não usa nenhuma
   estratégia de busca. Ele confere a **correção** de cada encontro listado, enquanto
   VAL-03 confere a **completude** em relação à força bruta.
6. Imprime um resumo JSON (total, por tipo, erros) e sai com código ≠ 0 se houver
   violação.

## 5. Equivalência nos datasets 6 e 7

`compare-strategies` ganha a opção `--every <k>`: compara as duas estratégias apenas
nos grupos de índice `0, k, 2k, …` e no último grupo. É uma amostra determinística e
distribuída pelo arquivo inteiro. O custo da força bruta medido na spec 003
(≈23 milhões de distâncias por segundo) indica que comparar os arquivos inteiros
(≈396 e ≈714 milhões de distâncias) leva dezenas de segundos. Por isso as duas
formas serão executadas: amostra (`--every 100`) e arquivo completo (`--every 1`).

## 6. Download dos datasets 6 e 7

`curl` grava a resposta direto em disco (`data/datasetN.txt.part`), sem passar pela
memória do processo. O tamanho final é comparado com o `Content-Length` informado
pelo servidor, e só então o arquivo é renomeado para `data/datasetN.txt`. Os datasets
ficam em `data/`, ignorado pelo Git.

## 7. Testes

| Arquivo | Cobertura |
| ------- | --------- |
| `test/output/json-writer.test.ts` | CA-03, CA-04 (temporário cresce com `flushBytes` pequeno; destino ausente até o fim), falha do iterável (CA-06), destino preexistente intacto, destino inválido (CA-07) |
| `test/cli/arguments.test.ts` | CA-01: combinações de argumentos, padrões e erros de uso |
| `test/process-dataset.test.ts` | Estatísticas, estratégia padrão, interrupção por `AbortSignal`, dataset só com cabeçalho → `[]` (CA-05) |
| `test/cli.test.ts` | CLI compilada via `spawnSync`: códigos de saída, mensagens, saída padrão, gabaritos byte a byte com as duas estratégias (CA-02, CA-08), dataset inválido sem output (CA-06), nome padrão do output |
| `test/output/validate-output.test.ts` | CA-09: o validador aceita os gabaritos e rejeita cada violação |

Para que seja testável, a lógica do validador fica em `src/output/validate-output.ts`
(função pura sobre o array já lido e, opcionalmente, sobre os registros do dataset).
`scripts/validate-output.ts` só faz a leitura e a impressão.

## 8. Riscos

- `rename` sobre um arquivo aberto por outro processo pode falhar no Windows; nesse
  caso o erro é reportado e o temporário removido.
- Uma interrupção forçada (`SIGKILL`, queda de energia) não executa a limpeza: o
  temporário pode sobrar, mas o destino continua sem conteúdo parcial.

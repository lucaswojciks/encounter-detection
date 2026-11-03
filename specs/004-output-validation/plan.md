# Plano técnico 004 — Saída e validação

- **Status:** Implementado
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
| `test/cli.test.ts` | CLI compilada via `spawnSync`: códigos de saída, mensagens, saída padrão, gabaritos byte a byte com as três estratégias quando os datasets 1 e 2 estão em `data/`, e um dataset sintético nos demais casos (CA-02, CA-08), dataset inválido sem output (CA-06), nome padrão do output |
| `test/output/validate-output.test.ts` | CA-09: o validador aceita os gabaritos e rejeita cada violação |

Para que seja testável, a lógica do validador fica em `src/output/validate-output.ts`
(função pura sobre o array já lido e, opcionalmente, sobre os registros do dataset).
`scripts/validate-output.ts` só faz a leitura e a impressão.

## 8. Riscos

- `rename` sobre um arquivo aberto por outro processo pode falhar no Windows; nesse
  caso o erro é reportado e o temporário removido.
- Uma interrupção forçada (`SIGKILL`, queda de energia) não executa a limpeza: o
  temporário pode sobrar, mas o destino continua sem conteúdo parcial.

## 9. Resultados

Executado em 2026-11-02 com Node.js 24.19.0, Windows 11 Pro, AMD Ryzen 5 5600X,
16 GB de RAM e SSD, a partir do build de produção (`npm run build`).

### 9.1 Download dos datasets 6 e 7

| Arquivo | Bytes recebidos | `Content-Length` | Situação |
| ------- | --------------: | ---------------: | -------- |
| `data/dataset6.txt` | 423 411 895 | 423 411 895 | completo |
| `data/dataset7.txt` | 638 210 371 | 638 210 371 | completo |

### 9.2 Outputs (CLI com `spatialHash`)

```
node dist/src/cli.js data/datasetN.txt      # → outputs/encontros-datasetN.json
```

Tempo e memória de 4 execuções por dataset (a de geração e mais 3 repetições):
**mediana [mínimo–máximo]**, com a mediana sendo a média dos dois valores centrais. A duração vai do início da leitura até a publicação do
arquivo; a memória é o RSS máximo do processo.

| Dataset | Registros | Timestamps | Encontros | `generico` | `faccao` | `protetiva` | Duração (s) | RSS máximo (MiB) | Output (bytes) |
| ------- | --------: | ---------: | --------: | ---------: | -------: | ----------: | ----------- | ---------------- | -------------: |
| 1 | 5 000 | 500 | 4 | 2 | 1 | 1 | 0,021 [0,020–0,021] | 46,8 [46,8–48,1] | 1 344 |
| 2 | 25 000 | 1 250 | 6 | 3 | 2 | 1 | 0,057 [0,056–0,057] | 55,0 [54,8–55,0] | 2 029 |
| 3 | 100 000 | 2 500 | 10 | 5 | 3 | 2 | 0,155 [0,154–0,165] | 56,0 [55,9–58,9] | 3 393 |
| 4 | 400 020 | 6 667 | 15 | 7 | 5 | 3 | 0,531 [0,525–0,533] | 63,3 [63,2–63,5] | 5 090 |
| 5 | 1 000 000 | 12 500 | 21 | 10 | 7 | 4 | 1,266 [1,240–1,294] | 80,0 [79,7–80,0] | 7 132 |
| 6 | 8 000 000 | 80 000 | 27 | 12 | 9 | 6 | 10,183 [10,150–10,285] | 106,9 [106,7–107,1] | 9 171 |
| 7 | 12 000 000 | 100 000 | 35 | 15 | 12 | 8 | 15,417 [15,360–16,194] | 160,8 [160,5–160,9] | 11 908 |

- As contagens de registros e timestamps dos datasets 6 e 7 (8 e 12 milhões; 80 000 e
  100 000) agora vêm de execução e confirmam as estimativas da análise.
- **Memória:** o heap retido após `gc()` (`measure-encounters --expose-gc`) é de 5,2 MiB
  no dataset 6 e 5,3 MiB no 7, o mesmo dos datasets menores (spec 003). O RSS e o pico
  de heap maiores (até 56 MiB no dataset 7) vêm de o V8 adiar a coleta do lixo
  temporário em execuções longas. Não há acúmulo.
- **Tempo:** nos datasets 6 e 7, a detecção leva 2,7 e 4,2 s e a leitura com o parsing
  leva 7,8 e 12,0 s (`measure-encounters`, mesma sessão). A leitura domina o tempo.
- Os outputs somam 40 067 bytes.

### 9.3 Gabaritos (VAL-01)

`outputs/encontros-dataset1.json` e `outputs/encontros-dataset2.json` são idênticos
byte a byte (`cmp`) a `respostas1.json` (1 344 bytes) e `respostas2.json` (2 029 bytes),
o que inclui quantidade, tipos, ids, timestamps, coordenadas, distâncias e estrutura.

### 9.4 Validador independente (VAL-02)

```
node dist/scripts/validate-output.js outputs/encontros-datasetN.json --dataset data/datasetN.txt
```

Para os sete outputs: JSON válido, 0 violações, com as contagens por tipo da tabela
9.2. O validador conferiu:
- campos, ordem das chaves e tipos JavaScript;
- tipos válidos e ids crescentes;
- distância `< 20` e igual bit a bit à recalculada;
- unicidade de (par, timestamp) e ordenação;
- posições e classificação conferidas contra os registros do dataset.

### 9.5 Equivalência entre estratégias (VAL-03)

| Verificação | Dataset 6 | Dataset 7 |
| ----------- | --------- | --------- |
| Amostra `--every 100` | 801 grupos, 0 divergências | 1 001 grupos, 0 divergências |
| Arquivo completo `--every 1` | 80 000 grupos, 0 divergências, 27 encontros | 100 000 grupos, 0 divergências, 35 encontros |
| CLI com `--search all` × `--search spatial` | arquivos idênticos byte a byte | arquivos idênticos byte a byte |

- A amostra determinística **não continha nenhum encontro** (0 nos grupos comparados),
  porque os encontros são raros. Ela confirma apenas a ausência de falsos positivos
  nesses grupos. A completude é garantida pela comparação do arquivo inteiro, que se
  mostrou viável: cerca de 74 s para os dois datasets juntos.
- Os datasets 1 a 5 também foram comparados por completo, com 0 divergências.
- Duração da CLI com `allPairs`: 24,3 s (dataset 6) e 40,7 s (dataset 7), contra cerca
  de 10,2 e 15,4 s com `spatialHash` (2,4× e 2,6× no tempo total; uma execução de
  `allPairs` por dataset).

### 9.6 Versionamento dos outputs (D2)

Os sete outputs somam 40 kB e o maior tem 11,9 kB. Na revisão final, eles passaram a ser
versionados como parte da entrega. O `.gitignore` admite apenas `outputs/encontros-*.json`,
e o `.gitattributes` os marca como `-text`, para que o checkout não converta as quebras de
linha e eles continuem idênticos aos gabaritos.

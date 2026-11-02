# Encounter Detection

Aplicação de linha de comando em TypeScript/Node.js que detecta **encontros geográficos**
entre indivíduos monitorados a partir de registros de localização com data e hora. Para cada
arquivo de entrada, ela gera um JSON com todos os pares de indivíduos que estiveram a menos de
20 metros um do outro no mesmo instante, classificados como encontro genérico, entre membros
da mesma facção ou envolvendo medida protetiva.

Os sete datasets oficiais (de 5 mil a 12 milhões de registros) são processados em streaming,
com memória estável. Os resultados dos datasets 1 e 2 são idênticos, byte a byte, aos gabaritos
oficiais.

---

## Sumário

1. [O desafio](#1-o-desafio)
2. [Funcionalidades](#2-funcionalidades)
3. [Tecnologias](#3-tecnologias)
4. [Arquitetura](#4-arquitetura)
5. [Processamento incremental](#5-processamento-incremental)
6. [Detecção e classificação](#6-detecção-e-classificação)
7. [Fórmula de Haversine](#7-fórmula-de-haversine)
8. [Busca de pares](#8-busca-de-pares)
9. [Complexidade](#9-complexidade)
10. [Instalação](#10-instalação)
11. [Uso da CLI](#11-uso-da-cli)
12. [Gerando os sete outputs](#12-gerando-os-sete-outputs)
13. [Testes](#13-testes)
14. [Resultados de validação](#14-resultados-de-validação)
15. [Desempenho](#15-desempenho)
16. [Por que esta abordagem](#16-por-que-esta-abordagem)
17. [Decisões técnicas e limitações](#17-decisões-técnicas-e-limitações)

---

## 1. O desafio

Cada dataset é um arquivo de texto com um registro de localização por linha:

```
idMonitorado;faccaoMonitorado;timestamp;latitude;longitude;medidaProtetiva;idsRestricaoMedida
7;1;"2024-01-01 00:00:00";-13.06443;-46.56289;false;
9;;"2024-01-01 00:00:00";1.64046;-69.53947;true;"10"
```

Regras aplicadas:

- só são comparadas posições com **timestamp exatamente igual**;
- a distância é calculada pela **fórmula de Haversine**, com raio terrestre de **6 371 000 m**;
- há encontro quando a distância é **estritamente menor que 20 m**;
- cada encontro é classificado como `generico`, `faccao` ou `protetiva`;
- há **um único registro por par e timestamp**.

A saída esperada é um array JSON no formato dos gabaritos:

```json
[
  {
    "tipo": "protetiva",
    "monitoradosEncontro": [9, 10],
    "timestamp": "2024-01-01 00:16:45",
    "posicoes": {
      "9": { "lat": 1.83355, "lon": -69.5461 },
      "10": { "lat": 1.83351, "lon": -69.54618 }
    },
    "distanciaMetros": 9.941503149375345
  }
]
```

> O exemplo está compactado para leitura. O arquivo real usa a formatação de
> `JSON.stringify(lista, null, 2)`, idêntica à dos gabaritos.

## 2. Funcionalidades

- Leitura em **streaming** de arquivos de qualquer tamanho, convertendo os registros direto
  dos bytes, com validação de cada campo e mensagens de erro com arquivo, linha e campo.
- Agrupamento dos registros por timestamp, sem carregar o arquivo em memória.
- Detecção de encontros com a fórmula de Haversine e classificação nos três tipos.
- Três estratégias de busca de pares, intercambiáveis e com resultados idênticos:
  - `latitudeSweep`: varredura por latitude em cada timestamp (padrão da CLI);
  - `spatialHash`: índice espacial em grade por timestamp;
  - `allPairs`: força bruta, mantida como referência de validação.
- Escrita **incremental e atômica** do JSON: um arquivo parcial nunca recebe o nome final.
- Scripts de validação independente, comparação entre estratégias e medição de desempenho.
- Nenhuma dependência de execução: apenas APIs nativas do Node.js.

## 3. Tecnologias

| Item | Uso |
| ---- | --- |
| Node.js ≥ 22 (desenvolvido e medido com 24.19.0) | Runtime, `fs` (`FileHandle`) para a leitura em blocos, `node:test` para testes, `util.parseArgs` para a CLI |
| TypeScript 7 (`tsc`), modo `strict` | Compilação; ESM com `module: NodeNext` |
| `@types/node` | Tipos das APIs nativas (dependência de desenvolvimento) |

As únicas dependências são de desenvolvimento: `typescript` e `@types/node`.

## 4. Arquitetura

```
arquivo .txt
   │  readDataset             leitura em blocos de 1 MiB (FileHandle.read)
   ▼
DatasetChunkParser           divide os blocos em linhas; converte as linhas canônicas direto
   │                         dos bytes (RecordBytesParser) e as demais com parseRecord
   ▼
TimestampGrouper             valida o cabeçalho e a ordem; agrupa registros consecutivos
   │  TimestampGroup         com o mesmo timestamp (um grupo por vez)
   ▼
detectEncounters(group, search)
   │  ├─ PairSearch          latitudeSweep (padrão), spatialHash ou allPairs (todos os pares)
   │  ├─ haversineDistance   distância exata de cada candidato; limiar < 20 m
   │  ├─ classifyEncounter   generico / faccao / protetiva
   │  └─ dedup + ordenação   um encontro por par e timestamp, ordem determinística
   ▼
toOutputEncounter            formato do gabarito
   ▼
writeJsonArray               JSON incremental em arquivo temporário → rename atômico
```

```
src/
├── cli.ts                    executável: argumentos, resumo, mensagens e códigos de saída
├── cli/arguments.ts          interpretação dos argumentos
├── process-dataset.ts        monta o fluxo leitura → detecção → escrita
├── dataset/                  leitura, parsing, validação e agrupamento (spec 001)
├── encounters/               Haversine, classificação, busca de pares e detecção (specs 002–003)
└── output/                   escrita do JSON e validador de outputs (spec 004)
test/                         testes unitários, de integração e de aceitação
test/fixtures/official/       datasets 1 e 2 e gabaritos oficiais (bytes originais)
scripts/                      validação, comparação de estratégias e medição
specs/                        especificações SDD (spec, plano e tarefas de cada funcionalidade)
outputs/                      os sete JSONs de encontros gerados
```

As regras de negócio ficam isoladas do I/O. O parsing e o agrupamento operam sobre linhas
de texto ou blocos de bytes, a detecção sobre grupos em memória, e só o adaptador de
leitura e o escritor acessam o disco. Isso permite testar cada etapa sem arquivos e trocar a estratégia de busca
sem tocar em distância, classificação ou formato de saída.

O projeto seguiu Spec-Driven Development. Cada funcionalidade tem especificação, plano
técnico e tarefas em [`specs/`](specs/README.md):

| Spec | Conteúdo |
| ---- | -------- |
| [001 — Processamento de datasets](specs/001-dataset-processing/spec.md) | Formato de entrada, validação, agrupamento, streaming e leitura a partir de bytes; inclui a [análise exploratória dos dados](specs/001-dataset-processing/dataset-analysis.md) e a engenharia reversa dos gabaritos |
| [002 — Detecção de encontros](specs/002-encounter-detection/spec.md) | Regras, classificação, unicidade, ordenação e precisão numérica |
| [003 — Otimização espacial](specs/003-spatial-optimization/spec.md) | Spatial hashing e varredura por latitude, prova de ausência de falsos negativos e benchmarks |
| [004 — Saída e validação](specs/004-output-validation/spec.md) | CLI, escrita do JSON e validação dos sete outputs |

## 5. Processamento incremental

A análise dos sete datasets mostrou que os registros já vêm **agrupados e ordenados por
timestamp**: todos os indivíduos aparecem em cada instante, em blocos contíguos, a cada
5 segundos. Isso permite um único passe pelo arquivo:

1. O arquivo é lido em blocos de 1 MiB, num buffer reutilizado, e dividido em linhas
   (LF, CRLF ou CR isolado; BOM; última linha sem quebra; linhas divididas entre blocos).
2. Cada linha é validada campo a campo, de uma de duas formas, com o mesmo resultado:
   - **caminho rápido:** linhas no formato canônico dos datasets são convertidas direto
     dos bytes, sem criar strings nem expressões regulares. Os números são calculados de
     forma exata: o mesmo `double` que `Number()` daria;
   - **caminho de texto:** qualquer outra linha (cabeçalho, linha vazia, formato
     incomum ou inválida) vai para o parser original, que valida cada campo com
     expressões regulares antes da conversão, porque `Number()` aceita formas inválidas
     como `""`, `0x10` ou `1e3`. Todas as mensagens de erro vêm dele.
3. Registros consecutivos com o mesmo timestamp formam um grupo. O grupo é entregue ao
   detector assim que o timestamp muda, e o próximo bloco só é lido quando o consumidor
   pede um grupo que os blocos já lidos não completam (contrapressão).
4. Um timestamp menor que o anterior é rejeitado com erro, porque o agrupamento em
   streaming depende dessa ordem.

A memória retida é proporcional ao **maior grupo** (até 120 registros), não ao arquivo.
Medido após coleta de lixo: cerca de 5 MiB de heap retido tanto em 100 mil quanto em 12
milhões de registros.

A primeira implementação, com `createReadStream` + `readline`, continua no código como
referência (`readDatasetLines`). Os dois leitores produzem exatamente os mesmos grupos nos
sete datasets (21 530 020 registros), e os testes os comparam com blocos de todos os
tamanhos, de 1 byte ao arquivo inteiro, incluindo cada tipo de erro de entrada
([spec 001, seção 12](specs/001-dataset-processing/spec.md#12-leitura-a-partir-de-bytes)).

O timestamp é preservado exatamente como no arquivo, sem as aspas, e comparado como texto.
Como tem largura fixa (`YYYY-MM-DD HH:MM:SS`), a ordem lexicográfica coincide com a
cronológica, sem conversões de fuso.

## 6. Detecção e classificação

Para cada grupo, a detecção avalia os pares candidatos fornecidos pela estratégia de busca:

1. ignora pares do mesmo id (um indivíduo não encontra a si mesmo);
2. calcula a distância exata com Haversine;
3. aceita o par se `distância < 20`;
4. classifica:
   - **`protetiva`**: um dos dois lista o outro em `idsRestricaoMedida` (verificado nos dois
     sentidos);
   - **`faccao`**: os dois têm facção e ela é a mesma;
   - **`generico`**: nos demais casos (inclusive facções diferentes, ou alguém com medida
     protetiva perto de uma pessoa fora da sua lista);
5. registra no máximo um encontro por par e timestamp;
6. ordena os encontros do grupo pelo menor id e depois pelo maior.

O resultado final fica em ordem cronológica e, no mesmo instante, por par de ids. Dentro
de `monitoradosEncontro`, os ids estão em ordem crescente. As regras de classificação foram
confirmadas comparando todos os pares dos datasets 1 e 2 com os gabaritos (detalhes na
[análise](specs/001-dataset-processing/dataset-analysis.md)).

## 7. Fórmula de Haversine

```ts
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

const sinHalfDeltaLat = Math.sin(toRadians(lat2 - lat1) / 2);
const sinHalfDeltaLon = Math.sin(toRadians(lon2 - lon1) / 2);
const a = sinHalfDeltaLat ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * sinHalfDeltaLon ** 2;
return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
```

Formas algebricamente equivalentes da fórmula produzem resultados diferentes nos últimos
bits do `double`. Foram testadas 36 variantes contra as 10 distâncias dos gabaritos. Esta
implementação reproduz as dez **bit a bit**, e os testes comparam distâncias com igualdade
exata, não com tolerância. Os detalhes que fazem diferença são:
- a diferença é calculada em graus antes da conversão;
- a conversão é `(x * Math.PI) / 180`;
- `asin` é usado em vez de `atan2`;
- cada `sin²` é um termo único.

## 8. Busca de pares

### O problema

A força bruta compara todos os pares de cada timestamp: `n(n − 1)/2` distâncias por grupo,
o que dá cerca de **714 milhões** de cálculos de Haversine no dataset 7. Como os indivíduos
estão espalhados por milhares de quilômetros, quase todos esses cálculos são inúteis: o
dataset 7 tem 35 encontros.

### Primeira estratégia: spatial hashing (`spatialHash`)

Para cada timestamp, os registros são distribuídos numa grade de latitude × longitude, e
cada registro é comparado apenas com os das **9 células** ao redor da sua:

- **Linhas** têm altura fixa equivalente a 20,02 m (20 m mais 0,1 % de margem).
- **Colunas** têm largura calculada para cada grupo a partir da maior latitude do grupo.
  Os meridianos se aproximam com a latitude, então a mesma distância corresponde a mais
  graus de longitude longe do equador.
- As colunas dividem os 360° em partes iguais e dão a volta no antimeridiano (−180/180).
  Perto dos polos, a grade usa uma coluna única.

A distância final de cada candidato continua sendo calculada por Haversine, pelo mesmo
código da força bruta. A estratégia só reduz os candidatos, e os pares são visitados na
mesma ordem relativa de `allPairs`.

### Por que não há falsos negativos

As dimensões da grade vêm de limites inferiores da própria fórmula de Haversine:

- `d ≥ R·|Δφ|`: um par a menos de 20 m tem diferença de latitude menor que a altura de
  uma linha e está em linhas vizinhas.
- `sin²(d/2R) ≥ cos²Φ · sin²(Δλ/2)`, sendo Φ a maior latitude do grupo: um par a menos de
  20 m tem diferença circular de longitude menor que a largura de uma coluna e está em
  colunas vizinhas.

A margem de 0,1 % cobre os erros de ponto flutuante, que ficam seis ordens de grandeza
abaixo dela, segundo uma verificação com cerca de 5 milhões de pares aleatórios. A prova
completa está no [plano da spec 003](specs/003-spatial-optimization/plan.md#3-garantia-de-ausência-de-falsos-negativos).
Uma grade com largura fixa em graus foi descartada: ou perderia pares em latitudes altas,
ou teria de ser tão larga que não filtraria nada.

### Estratégia padrão: varredura por latitude (`latitudeSweep`)

O profiling mostrou que, com grupos de até 120 registros, montar a grade (um `Map`, uma
lista por célula e 9 consultas por registro) custava mais que as distâncias que ela
evitava. A varredura usa as **mesmas duas desigualdades**, sem estrutura de hash:

1. os índices do grupo são ordenados por latitude;
2. cada registro é comparado só com os seguintes cuja latitude difere no máximo pela
   altura de uma linha (20,02 m em graus);
3. dentro dessa faixa, o par só é candidato se `cos Φ · |sin(Δλ/2)| < sin(D'/2R)`, com Φ
   a maior latitude **do par**;
4. os candidatos são ordenados para seguir a ordem de `allPairs` e visitados.

`|sin(Δλ/2)|` é igual para a diferença direta e para a que dá a volta pelo antimeridiano,
e perto dos polos `cos Φ ≈ 0` deixa qualquer longitude passar. Por isso não há casos
especiais. A justificativa completa está no
[plano da spec 003](specs/003-spatial-optimization/plan.md#12-varredura-por-latitude-spec-seção-7).
As três estratégias produzem encontros idênticos em todos os timestamps dos sete
datasets, e `spatialHash` continua disponível com `--search spatial`.

## 9. Complexidade

Para um grupo com `n` registros, `b` pares na mesma faixa de latitude, `k` pares
candidatos e `e` encontros:

| | `allPairs` | `spatialHash` | `latitudeSweep` |
| - | ---------- | ------------- | --------------- |
| Cálculos de Haversine | `n(n − 1)/2` | `k` | `k` |
| Tempo por grupo | `O(n²)` | `O(n + k log k)` esperado; `O(n²)` se todos estiverem na mesma célula | `O(n log n + b + k log k)`; `O(n²)` se todos estiverem na mesma faixa de latitude |
| Memória adicional por grupo | `O(e)` | `O(n + e)` | `O(n + e)` |

Para o arquivo inteiro, com `G` grupos, o tempo é `O(G·n²)` com `allPairs`, `O(G·n)`
esperado com `spatialHash` e `O(G·n log n)` com `latitudeSweep`. Com `n ≤ 120`, ordenar
números custa menos que montar a grade. A memória é `O(maior grupo)` nas três
estratégias, independentemente do tamanho do arquivo. A leitura é linear no tamanho do
arquivo.

## 10. Instalação

Requisitos: Node.js 22 ou superior e npm.

```bash
npm ci
npm run build
```

`npm run build` limpa `dist/` e compila `src/`, `test/` e `scripts/` com `tsc`.
`npm run typecheck` verifica os tipos sem gerar arquivos.

## 11. Uso da CLI

```
node dist/src/cli.js <dataset> [--output <arquivo.json>] [--search sweep|spatial|all]
```

| Opção | Descrição |
| ----- | --------- |
| `<dataset>` | Arquivo de entrada (obrigatório) |
| `-o`, `--output <arquivo>` | Arquivo de saída. Padrão: `outputs/encontros-<dataset>.json` |
| `--search sweep\|spatial\|all` | Estratégia de busca: `sweep` (varredura por latitude, padrão), `spatial` (spatial hashing) ou `all` (força bruta, para validação) |
| `-h`, `--help` | Ajuda |

Exemplos:

```bash
node dist/src/cli.js test/fixtures/official/dataset1.txt
node dist/src/cli.js data/dataset6.txt --output resultado.json
node dist/src/cli.js data/dataset6.txt --search all -o resultado-forca-bruta.json
npm start -- test/fixtures/official/dataset2.txt
```

Saída do primeiro exemplo (valores de uma execução; no Windows o caminho aparece com `\`):

```
Dataset:    test/fixtures/official/dataset1.txt
Output:     outputs/encontros-dataset1.json
Search:     latitudeSweep
Records:    5000
Timestamps: 500
Encounters: 4 (generico 2, faccao 1, protetiva 1)
Duration:   0.015 s
Max RSS:    48.7 MiB
```

Códigos de saída:

| Código | Situação |
| ------ | -------- |
| `0` | Sucesso |
| `1` | Erro de entrada, de processamento ou de escrita (a mensagem informa arquivo, linha e campo quando aplicável) |
| `2` | Argumentos inválidos |
| `130` | Interrompido com Ctrl+C |

O JSON é escrito num arquivo temporário no diretório de destino e só é renomeado para o
nome final quando o processamento termina. Em caso de erro, nenhum arquivo final é criado,
e um output anterior com o mesmo nome é preservado. A CLI também se recusa a gravar a saída
sobre o próprio dataset de entrada.

## 12. Gerando os sete outputs

Os datasets 1 e 2 estão no repositório (`test/fixtures/official/`). Os demais, de 5 MB a
638 MB, ficam fora do Git e são baixados para `data/`.

Bash (Linux, macOS ou Git Bash):

```bash
mkdir -p data
for i in 1 2 3 4 5 6 7; do
  curl -fSL -o "data/dataset$i.txt" "https://bucket-projeto-trainee.s3.sa-east-1.amazonaws.com/dataset$i.txt"
done

npm run build
for i in 1 2 3 4 5 6 7; do
  node dist/src/cli.js "data/dataset$i.txt"
done
```

PowerShell (Windows). `Invoke-WebRequest -OutFile` grava o download direto em disco. A barra
de progresso é desligada porque, no Windows PowerShell 5.1, ela torna os arquivos grandes muito
lentos:

```powershell
New-Item -ItemType Directory -Force data | Out-Null
$ProgressPreference = "SilentlyContinue"
1..7 | ForEach-Object {
  Invoke-WebRequest -Uri "https://bucket-projeto-trainee.s3.sa-east-1.amazonaws.com/dataset$_.txt" -OutFile "data/dataset$_.txt"
}

npm run build
1..7 | ForEach-Object { node dist/src/cli.js "data/dataset$_.txt" }
```

Os arquivos são gravados em `outputs/encontros-dataset1.json` … `outputs/encontros-dataset7.json`.
Os sete outputs gerados estão versionados nessa pasta.

Para conferir os resultados no PowerShell (`True` indica arquivos idênticos):

```powershell
(Get-FileHash outputs/encontros-dataset1.json).Hash -eq (Get-FileHash test/fixtures/official/respostas1.json).Hash
(Get-FileHash outputs/encontros-dataset2.json).Hash -eq (Get-FileHash test/fixtures/official/respostas2.json).Hash
```

Para conferir os resultados no Bash:

```bash
# outputs 1 e 2 idênticos aos gabaritos oficiais
cmp outputs/encontros-dataset1.json test/fixtures/official/respostas1.json
cmp outputs/encontros-dataset2.json test/fixtures/official/respostas2.json

# validação independente da estratégia de busca, conferindo cada encontro contra o dataset
node dist/scripts/validate-output.js outputs/encontros-dataset7.json --dataset data/dataset7.txt

# equivalência de latitudeSweep e spatialHash com allPairs em todos os timestamps (--every k para amostrar)
node dist/scripts/compare-strategies.js data/dataset7.txt

# equivalência entre o leitor por bytes e a leitura de referência com readline
node dist/scripts/compare-readers.js data/dataset7.txt
```

## 13. Testes

```bash
npm test
```

O comando compila o projeto e executa os 191 testes com `node:test`. Eles cobrem:

- **Parsing e agrupamento:** cada campo aceito e rejeitado, CRLF, BOM, linhas vazias, ordem
  cronológica, contrapressão e mensagens de erro.
- **Leitor por bytes:** linhas canônicas iguais às do parser original; linhas fora do
  formato entregues a ele; 200 mil coordenadas aleatórias iguais bit a bit a `Number()`;
  100 mil linhas aleatórias com mutações; comparação com a leitura por `readline` em
  blocos de todos os tamanhos, com terminações, BOM, CR isolado, UTF-8 inválido e cada
  tipo de erro; fechamento do arquivo no fim, em erro e em interrupção.
- **Haversine:** as 10 distâncias oficiais bit a bit, e o limiar com um par a exatamente
  20,0 m.
- **Classificação:** todas as combinações de facção e restrição.
- **Detecção:** unicidade, ids repetidos, ordenação e independência da ordem do input.
- **Busca de pares:** `spatialHash` e `latitudeSweep` comparadas com a força bruta pela
  mesma suíte: casos construídos (bordas de células, antimeridiano, polos, várias
  latitudes, grupos densos) e 400 grupos aleatórios com semente fixa; casos próprios da
  varredura (limite da faixa de latitude, ordem de visita).
- **Escrita do JSON:** igual a `JSON.stringify(lista, null, 2)`, incremental, atômica e
  limpa em caso de falha.
- **CLI:** argumentos, códigos de saída, mensagens e escrita impossível.
- **Aceitação:** datasets 1 e 2 processados de ponta a ponta, com as três estratégias,
  idênticos aos gabaritos.

Mutações temporárias do código compilado nas duas otimizações (por exemplo: faixa de
latitude menor, longitude sem a volta do antimeridiano, decimais calculados por
multiplicação, linha entre blocos sem cópia, arquivo não fechado) fazem testes falharem.
A lista está nos planos das specs
[001](specs/001-dataset-processing/plan.md#125-validação) e
[003](specs/003-spatial-optimization/plan.md#125-validação).

## 14. Resultados de validação

| Dataset | Registros | Timestamps | Encontros | `generico` | `faccao` | `protetiva` | Output (bytes) |
| ------- | --------: | ---------: | --------: | ---------: | -------: | ----------: | -------------: |
| 1 | 5 000 | 500 | 4 | 2 | 1 | 1 | 1 344 |
| 2 | 25 000 | 1 250 | 6 | 3 | 2 | 1 | 2 029 |
| 3 | 100 000 | 2 500 | 10 | 5 | 3 | 2 | 3 393 |
| 4 | 400 020 | 6 667 | 15 | 7 | 5 | 3 | 5 090 |
| 5 | 1 000 000 | 12 500 | 21 | 10 | 7 | 4 | 7 132 |
| 6 | 8 000 000 | 80 000 | 27 | 12 | 9 | 6 | 9 171 |
| 7 | 12 000 000 | 100 000 | 35 | 15 | 12 | 8 | 11 908 |

- **Datasets 1 e 2:** os outputs são idênticos byte a byte a `respostas1.json` e
  `respostas2.json`, o que inclui tipos, ids, timestamps, coordenadas, distâncias e
  estrutura.
- **Datasets 1 a 7, validador independente:** os sete outputs passam sem nenhuma violação.
  O validador não usa nenhuma estratégia de busca e confere:
  - estrutura e ordem das chaves;
  - tipos válidos;
  - distância menor que 20 m e igual, bit a bit, à recalculada;
  - pares únicos por timestamp e ordenação;
  - posições e classificação batendo com os registros do dataset.
- **Datasets 1 a 7, equivalência entre estratégias:** `latitudeSweep`, `spatialHash` e
  `allPairs` produzem encontros idênticos em todos os timestamps de todos os datasets. A
  CLI com `--search sweep`, `spatial` e `all` gera, nos sete datasets, arquivos idênticos
  byte a byte aos outputs versionados.
- **Datasets 1 a 7, equivalência entre leitores:** o leitor por bytes e a leitura de
  referência com `readline` produzem os mesmos grupos e registros nos 21 530 020
  registros.
- **Datasets 3 a 5:** os resultados também coincidem com um cálculo de força bruta escrito
  de forma independente durante a análise exploratória.

## 15. Desempenho

Medições num AMD Ryzen 5 5600X com 16 GB de RAM, SSD, Windows 11 e Node.js 24.19.0, a
partir do build de produção, com os arquivos no cache do sistema operacional. Cada medição
roda num processo separado. **Anterior** é a versão com leitura por `readline` e
`spatialHash` (commit `3a521f6` da `main`). **Atual** é a versão com leitor por bytes e
`latitudeSweep`. São 5 rodadas alternando as duas versões; os valores são **mediana
[mínimo–máximo]**, em segundos.

### Aplicação completa (CLI: leitura, detecção e escrita do JSON)

`Duration` reportado pela CLI, que mede da abertura do dataset ao arquivo publicado:

| Dataset | Anterior | Atual | Redução | Fator |
| ------- | -------- | ----- | ------: | ----: |
| 1 | 0,025 [0,021–0,054] | 0,013 [0,012–0,017] | 48 % | 1,9× |
| 2 | 0,062 [0,059–0,063] | 0,024 [0,024–0,058] | 61 % | 2,6× |
| 3 | 0,165 [0,158–0,242] | 0,059 [0,055–0,063] | 64 % | 2,8× |
| 4 | 0,600 [0,551–0,606] | 0,143 [0,138–0,166] | 76 % | 4,2× |
| 5 | 1,434 [1,284–1,867] | 0,344 [0,326–0,417] | 76 % | 4,2× |
| 6 | 11,311 [10,538–12,370] | 2,532 [2,247–2,942] | 78 % | 4,5× |
| 7 | 16,107 [15,914–17,504] | 3,698 [3,509–3,775] | 77 % | 4,4× |
| **Soma das medianas** | **29,704** | **6,813** | **77 %** | **4,4×** |

Tempo do processo inteiro (`node dist/src/cli.js …`, incluindo a inicialização do Node,
de cerca de 60 ms): soma das medianas de **30,153 s** antes e **7,270 s** agora (4,1×).
Nos datasets 1 e 2, a inicialização domina e as faixas das duas versões se sobrepõem.

### Por etapa

| Dataset | Leitura e parsing, anterior | Leitura e parsing, atual | Detecção `spatialHash` | Detecção `latitudeSweep` |
| ------- | --------------------------- | ------------------------ | ---------------------- | ------------------------ |
| 1 | 0,013 | 0,007 | 0,005 | 0,002 |
| 2 | 0,038 | 0,018 | 0,018 | 0,004 |
| 3 | 0,114 | 0,042 | 0,046 | 0,012 |
| 4 | 0,402 | 0,108 | 0,158 | 0,029 |
| 5 | 0,994 | 0,270 | 0,368 | 0,072 |
| 6 | 8,037 | 1,812 | 2,843 | 0,535 |
| 7 | 11,848 | 2,715 | 4,316 | 0,784 |
| **Soma** | **21,446** | **4,972** (4,3×) | **7,754** | **1,438** (5,4×) |

Medianas de 5 execuções: a leitura com `measure-dataset` e a detecção com
`measure-encounters` (soma dos tempos de `detectEncounters` por grupo). Em todos os
datasets e nas duas etapas, a pior execução atual foi mais rápida que a melhor anterior.

### Memória

RSS máximo da CLI (mediana de 5 execuções):

| Dataset | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| ------- | -: | -: | -: | -: | -: | -: | -: |
| Anterior | 49,7 MiB | 56,1 MiB | 57,3 MiB | 64,6 MiB | 81,0 MiB | 108,1 MiB | 161,6 MiB |
| Atual | 49,3 MiB | 51,3 MiB | 52,4 MiB | 52,2 MiB | 55,6 MiB | 63,8 MiB | 64,6 MiB |

- A memória **diminuiu**. A leitura anterior criava, por linha, uma string, um array de
  campos e resultados de expressões regulares; a grade criava um `Map` e listas por
  timestamp. Esse lixo temporário se acumulava entre coletas.
- O heap **retido** continua `O(maior grupo)`: o arquivo nunca fica em memória, e o
  leitor mantém só um buffer de 1 MiB e a linha incompleta entre blocos.

### Comparação com a força bruta

Só a detecção, dos benchmarks da [spec 003](specs/003-spatial-optimization/plan.md#11-resultados)
(5 execuções; mediana):

| Dataset | Registros por timestamp | Haversine: `allPairs` | Haversine: `spatialHash` | Haversine: `latitudeSweep` | Tempo `allPairs` | Tempo `spatialHash` | Tempo `latitudeSweep` |
| ------- | ----------------------: | --------------------: | -----------------------: | -------------------------: | ---------------: | ------------------: | --------------------: |
| 3 | 40 | 1 950 000 | 14 | 12 | 0,089 | 0,044 | 0,012 |
| 4 | 60 | 11 800 590 | 16 | 15 | 0,511 | 0,151 | 0,029 |
| 5 | 80 | 39 500 000 | 22 | 21 | 1,688 | 0,345 | 0,072 |

Os tempos de `allPairs` e `spatialHash` vêm da medição da spec 003, e os de
`latitudeSweep` da medição acima, na mesma máquina. A varredura avalia um pouco menos
pares porque o filtro de longitude usa a latitude de cada par, e não a maior do grupo.

Resultados completos: specs [001](specs/001-dataset-processing/plan.md#126-resultados-ca-17),
[003](specs/003-spatial-optimization/plan.md#126-benchmark-ca-11) e
[004](specs/004-output-validation/plan.md#9-resultados).

## 16. Por que esta abordagem

O problema tem três características que definiram a solução:

1. **Só importam posições no mesmo instante, e os arquivos já vêm agrupados por
   timestamp.** Isso transforma o problema em muitos problemas pequenos e independentes, de
   até 120 pontos cada. Um único passe em streaming resolve todos, com memória constante, sem
   ordenar nem indexar o arquivo inteiro e sem banco de dados.
2. **Os encontros são raríssimos e os pontos são esparsos.** Em 12 milhões de registros há
   35 encontros. A força bruta gasta quase todo o tempo provando que pessoas a centenas de
   quilômetros não estão a 20 m. Filtrar por condições necessárias de distância elimina
   esse trabalho: no dataset 5, as distâncias calculadas caem de 39,5 milhões para 22.
   Outras estruturas (k-d tree, R-tree) também funcionariam. A primeira versão usou uma
   grade com células do tamanho do limiar, a mais simples que garante vizinhança 3 × 3.
   Medida, a grade se mostrou mais cara que as distâncias que evitava, e foi substituída
   por uma varredura ordenada por latitude, com as mesmas condições e sem estrutura de
   hash.
3. **O resultado precisa ser exato.** A correção não depende de testes: os filtros foram
   derivados da própria fórmula de Haversine, e a decisão final de cada par continua sendo
   a distância exata. A força bruta foi mantida no código como oráculo, e as três
   estratégias foram comparadas em todos os timestamps dos sete datasets.
4. **Depois disso, o gargalo era ler o texto.** Converter 12 milhões de linhas com
   `split`, expressões regulares e uma iteração assíncrona por linha passou a ser a maior
   parte do tempo. O leitor por bytes resolve isso sem duplicar as regras: ele só aceita o
   formato canônico, de forma exata, e entrega qualquer outra linha ao parser original.

O restante segue o mesmo critério de simplicidade verificável:
- só APIs nativas do Node;
- regras de negócio separadas do I/O;
- fórmula reproduzindo os gabaritos bit a bit;
- escrita atômica para que um arquivo de resultado nunca seja parcial.

## 17. Decisões técnicas e limitações

**Decisões**

- **Erros de entrada interrompem o processamento** (com arquivo, linha e campo), em vez de
  descartar linhas, para que um resultado nunca venha de dados parcialmente inválidos.
- **Registros fora de ordem cronológica são rejeitados**, porque o agrupamento em streaming
  depende de grupos contíguos. Os sete datasets oficiais estão ordenados.
- **A ordenação dos encontros** (timestamp, menor id, maior id) torna a saída determinística
  e independente da estratégia de busca. Os gabaritos são compatíveis com ela.
- **`allPairs` é o padrão da biblioteca e `latitudeSweep` é o padrão da CLI.** A
  referência continua disponível em qualquer ponto para validação, e `spatialHash`
  continua como alternativa (`--search spatial`).
- **Dois caminhos de conversão, uma só regra.** O caminho rápido do leitor só aceita um
  subconjunto do formato em que o resultado é comprovadamente o do parser original.
  Toda validação e toda mensagem de erro continuam no parser original. A leitura com
  `readline` foi mantida como referência (`readDatasetLines`).

**Limitações**

- **Classificação simultânea:** um par em que um lista o outro e ambos são da mesma facção
  não ocorre em nenhum dataset oficial, e o enunciado não define seu tipo. A implementação
  verifica `protetiva` antes de `faccao`. É um detalhe de implementação, não uma regra
  validada.
- **Último bit nos datasets sem gabarito:** duas associações da multiplicação na fórmula
  reproduzem os 10 gabaritos, mas diferem em 1 ULP em alguns pares dos datasets 4 e 5. Foi
  adotada a forma com `sin²` como termo único. O conjunto de encontros não muda, mas um
  gabarito oficial dos datasets 3 a 7 poderia indicar a outra forma.
- **Pior caso da busca:** se todos os indivíduos de um timestamp estiverem na mesma faixa
  de latitude de 20 m (ou, com `spatialHash`, na mesma célula), o custo volta a ser
  quadrático, sem perda de correção. Isso não ocorre nos dados oficiais.
- **Manutenção do leitor por bytes:** uma mudança nas regras de `parseRecord` exige
  rever o caminho rápido (`RecordBytesParser`). Os testes diferenciais detectam
  divergências nos casos gerados, mas não substituem essa revisão.
- **Interrupção forçada:** um `SIGKILL` ou queda de energia pode deixar o arquivo temporário
  no diretório de saída, mas nunca um output parcial com o nome final.
- **Medições:** os tempos foram medidos numa única máquina e servem como referência
  relativa entre as estratégias.

# Spec 002 — Detecção de encontros

- **Status:** Implementada (em revisão)
- **Depende de:** [Spec 001](../001-dataset-processing/spec.md) (grupos por timestamp)
- **Documentos relacionados:** [`plan.md`](plan.md), [`tasks.md`](tasks.md),
  [`../001-dataset-processing/dataset-analysis.md`](../001-dataset-processing/dataset-analysis.md)

## 1. Objetivo

Para cada grupo de registros com o mesmo timestamp produzido pela spec 001,
identificar os pares de indivíduos a menos de 20 metros, classificar cada encontro
como `generico`, `faccao` ou `protetiva` e produzir um registro por par e timestamp
com os ids, o timestamp, as posições e a distância.

## 2. Diretriz de escopo

Esta spec implementa apenas as regras do enunciado confirmadas pelos gabaritos
oficiais (`respostas1.json` e `respostas2.json`). Ela não cria hierarquias entre
classificações, regras de exclusão nem restrições para cenários que o enunciado não
descreve. As referências entre colchetes, como [4.4], apontam para as conclusões da
seção 4 de `dataset-analysis.md`.

## 3. Fora de escopo

- Leitura e validação do arquivo de entrada (spec 001).
- Indexação espacial e otimizações de desempenho (spec 003).
- Escrita do arquivo JSON, interface de linha de comando e validação da saída
  (spec 004).

## 4. Regras de negócio

### 4.1 Elegibilidade do par

- **R-01 Timestamp idêntico.** Só são comparados registros do **mesmo grupo** da
  spec 001, isto é, com texto de timestamp idêntico. Registros de timestamps
  diferentes nunca formam encontro, por mais próximos que estejam.
- **R-02 Dois indivíduos distintos.** Um encontro envolve dois ids diferentes. Um
  registro nunca é comparado consigo mesmo nem com outro registro do mesmo id.
- **R-03 Distância.** A distância é calculada pela fórmula de Haversine com raio
  terrestre de **6 371 000 m**, sobre as coordenadas em graus decimais dos dois
  registros [4.1].
- **R-04 Limiar estrito.** Há encontro se e somente se a distância for
  **estritamente menor que 20 m**. A distância de exatamente 20 m não é encontro
  [4.2, 4.3b].

### 4.2 Classificação

Cada encontro recebe exatamente um tipo:

- **R-05 `protetiva`.** Um dos dois indivíduos lista o outro em
  `idsRestricaoMedida`. A verificação é feita nos dois sentidos, porque o par não
  tem ordem [4.5, 4.5b].
- **R-06 `faccao`.** Os dois indivíduos têm facção e a facção é a mesma [4.4].
- **R-07 `generico`.** O encontro não satisfaz R-05 nem R-06 [4.4b, 4.6].

Notas sobre as regras:

- R-05 depende apenas da lista de restrições. O campo `medidaProtetiva` é preservado
  pela spec 001, mas não altera a classificação: nos dados oficiais ele é `true` se e
  somente se a lista não está vazia [4.5c].
- Pelas definições, um encontro entre membros de facções diferentes, entre um membro
  de facção e alguém sem facção, ou entre alguém com medida protetiva e uma pessoa
  fora da sua lista é `generico`. Isso decorre de R-05 a R-07 e não é uma regra a
  mais.
- **Sobreposição de R-05 e R-06** (um par que se lista e é da mesma facção): o
  enunciado e os gabaritos não tratam desse caso, e esta spec não cria requisito para
  ele. A situação não ocorre em nenhum dataset oficial: nos datasets 1 a 7, nenhum
  indivíduo com lista de restrição e nenhum alvo de restrição tem facção (verificado
  nos arquivos completos 1 a 5 e no primeiro grupo dos datasets 6 e 7). Como a
  classificação precisa devolver um único tipo, a implementação verifica as condições
  numa ordem fixa. Essa ordem é um **detalhe de implementação** documentado no plano
  (seção 5), não uma regra de negócio (decisão D1).

### 4.3 Unicidade

- **R-08 Um registro por par e timestamp.** Cada par não ordenado de ids gera no
  máximo um encontro por timestamp [4.8].
- **R-09 Timestamps consecutivos são independentes.** Se o mesmo par fica a menos de
  20 m em vários timestamps, há um encontro em **cada** um deles. Encontros
  consecutivos não são fundidos (decisão A2 da análise; exemplo real: par 28–31 do
  dataset 3, em três timestamps seguidos).
- **R-10 Ids repetidos no grupo.** A spec 001 não rejeita o mesmo id repetido num
  timestamp. Nesse caso, por R-08, o par é registrado **uma única vez**, usando a
  primeira combinação de registros encontrada na ordem do input. Não ocorre nos dados
  oficiais.

## 5. Dados de cada encontro

| Dado | Origem | Regra |
| ---- | ------ | ----- |
| Tipo | R-05 a R-07 | `generico`, `faccao` ou `protetiva` |
| Ids | `id` dos dois registros | Em **ordem crescente** [4.9] |
| Timestamp | `timestamp` do grupo | Texto idêntico ao do input, sem as aspas |
| Posições | `latitude` e `longitude` de cada registro | Valores numéricos da spec 001, sem arredondamento, indexados pelo id |
| Distância | R-03 | Valor `double` calculado, sem arredondamento |

O formato do objeto de saída segue o gabarito oficial: chaves `tipo`,
`monitoradosEncontro`, `timestamp`, `posicoes` (`{ "<id>": { "lat", "lon" } }`) e
`distanciaMetros`, nesta ordem [3.1]. A escrita do arquivo é escopo da spec 004.

## 6. Ordem dos encontros

O enunciado não define ordem. Para que o resultado seja determinístico e independente
do algoritmo de busca (spec 003):

- **O-01** Os encontros seguem a ordem dos grupos no input, que é cronológica pela
  spec 001.
- **O-02** Dentro de um timestamp, os encontros são ordenados pelo menor id e, em
  seguida, pelo maior id.

Os gabaritos têm no máximo um encontro por timestamp, ordenados por timestamp, e são
compatíveis com O-01 e O-02 [4.9].

## 7. Processamento incremental

- **RI-01** A detecção processa **um grupo por vez**, à medida que a spec 001 os
  entrega. Nenhum estado atravessa grupos (consequência de R-01).
- **RI-02** Os encontros de um grupo ficam disponíveis assim que o grupo é
  processado, sem aguardar o fim do arquivo.
- **RI-03** A memória adicional é proporcional ao tamanho do grupo e ao número de
  encontros do grupo, e não ao tamanho do arquivo.

## 8. Critérios de aceitação

| ID | Critério | Verificação |
| -- | -------- | ----------- |
| CA-01 | Os encontros detectados nos datasets 1 e 2 são **iguais** aos gabaritos: mesma quantidade, mesmos pares, timestamps, tipos, posições e distâncias (igualdade exata do `double`), na mesma ordem. | Teste automatizado com os fixtures oficiais |
| CA-02 | Não há falsos positivos nem falsos negativos nos datasets 1 e 2 (consequência de CA-01). | Teste automatizado |
| CA-03 | As 10 distâncias oficiais são reproduzidas bit a bit pela função de distância, nos dois sentidos de argumento. | Teste automatizado |
| CA-04 | Uma distância menor que 20 m gera encontro; uma distância igual a 20 m ou maior, não. Pares geométricos logo abaixo e logo acima do limiar são testados. | Teste automatizado |
| CA-05 | Registros próximos em timestamps diferentes não geram encontro. | Teste automatizado |
| CA-06 | Nenhum par aparece mais de uma vez no mesmo timestamp, inclusive com ids repetidos no grupo; um id nunca encontra a si mesmo. | Teste automatizado |
| CA-07 | Um par próximo em três timestamps consecutivos gera três encontros, um por timestamp. | Teste automatizado sintético; verificação manual com o par 28–31 do dataset 3 |
| CA-08 | Cada tipo é atribuído conforme R-05 a R-07, inclusive restrição listada só por um dos lados (nos dois sentidos), facções diferentes e facção × sem facção. | Teste automatizado |
| CA-09 | Ids em ordem crescente, timestamp idêntico ao input, posições e distância sem arredondamento, e chaves na ordem do gabarito. | Teste automatizado |
| CA-10 | A detecção sobre um fluxo de grupos entrega os encontros de um grupo antes de consumir o grupo seguinte. | Teste automatizado |
| CA-11 | Nos datasets 3, 4 e 5, as quantidades de encontros são 10, 15 e 21, iguais à força bruta independente da análise exploratória (seção 3.5). | Verificação manual documentada (arquivos não versionados) |

## 9. Decisões

| ID | Questão | Proposta | Situação |
| -- | ------- | -------- | -------- |
| D1 | Par que satisfaz R-05 e R-06 ao mesmo tempo | Nenhuma regra de negócio e nenhuma interrupção do processamento. A classificação verifica as condições numa ordem fixa, registrada no plano como detalhe de implementação. | Aprovada |
| D2 | Encontros em timestamps consecutivos | Um encontro por timestamp (R-09). | Aprovada |
| D3 | Ordenação | Timestamps em ordem cronológica (O-01); no mesmo timestamp, menor id e depois maior id, numericamente (O-02); ids em ordem crescente em `monitoradosEncontro`. | Aprovada |
| D4 | Ordem dos ids no encontro | Crescente. | Confirmada pelos 10 exemplos |
| D5 | Fórmula exata de Haversine | Variante que reproduz os gabaritos bit a bit (plano, seção 4). | Confirmada pelos 10 exemplos |

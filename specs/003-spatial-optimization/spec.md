# Spec 003 — Otimização espacial

- **Status:** Implementada (em revisão)
- **Depende de:** [Spec 002](../002-encounter-detection/spec.md) (detector de referência e
  interface `PairSearch`)
- **Documentos relacionados:** [`plan.md`](plan.md), [`tasks.md`](tasks.md)

## 1. Objetivo

Reduzir o número de cálculos de Haversine da detecção com uma estratégia de busca
por **spatial hashing**, que entregue ao detector apenas os pares de registros
espacialmente relevantes de cada timestamp, **sem alterar nenhum encontro**
produzido pela estratégia de referência `allPairs`.

## 2. Escopo

- Nova estratégia `spatialHash`, que implementa a interface `PairSearch` da spec 002.
- Manutenção de `allPairs` como referência e oráculo de validação.
- Testes de equivalência e benchmarks comparativos.

Fora de escopo: paralelismo, mudanças em leitura, Haversine, classificação, ordenação
ou formato de saída, CLI e escrita de arquivos (spec 004).

## 3. Requisitos

- **RS-01 Indexação por timestamp.** O índice espacial é construído para cada grupo
  da spec 001 e descartado ao fim do grupo. Nada atravessa grupos.
- **RS-02 Candidatos relevantes.** A estratégia visita apenas os pares cujas células
  são iguais ou vizinhas.
- **RS-03 Sem falsos negativos.** Todo par de registros cuja distância calculada por
  `haversineDistance` seja menor que 20 m é visitado. Isso deve ser garantido por
  argumento matemático (plano, seção 3), e não apenas por testes.
- **RS-04 Latitude.** A largura das células em longitude considera a contração dos
  meridianos com a latitude.
- **RS-05 Validação final por Haversine.** A estratégia só seleciona candidatos; a
  decisão de encontro continua sendo a de `detectEncounters` (distância exata e
  limiar estrito).
- **RS-06 Regras inalteradas.** Classificação, unicidade por par e timestamp,
  ordenação e formato de saída são os da spec 002, sem duplicação de lógica.
- **RS-07 Equivalência total.** Para qualquer grupo, `detectEncounters(group, spatialHash)`
  é igual a `detectEncounters(group, allPairs)`: mesmos encontros, tipos, ids,
  timestamps, coordenadas, distâncias e ordem.
- **RS-08 Visita única.** Cada par candidato é visitado no máximo uma vez por grupo, e
  sempre na orientação e na ordem relativa de `allPairs` (registro anterior no input
  primeiro). Isso mantém a regra R-10 da spec 002 (primeira combinação vence)
  idêntica entre as estratégias, mesmo com ids repetidos.
- **RS-09 Seleção simples.** A estratégia é escolhida passando `allPairs` ou
  `spatialHash` como parâmetro de `detectEncounters` / `detectDatasetEncounters`.
- **RS-10 Sem dependências novas** e sem estruturas que cresçam com o arquivo.

## 4. Invariantes

- **I-01** Para quaisquer dois registros `a` e `b` do mesmo grupo com
  `haversineDistance(a, b) < 20`, `spatialHash` chama `visit(a, b)` exatamente uma vez,
  com `a` antes de `b` no input.
- **I-02** `spatialHash` nunca chama `visit` com o mesmo par duas vezes, nem com um
  registro e ele mesmo.
- **I-03** A memória adicional por grupo é `O(n)`, com `n` = registros do grupo.

## 5. Critérios de aceitação

| ID | Critério | Verificação |
| -- | -------- | ----------- |
| CA-01 | Datasets 1 e 2 com `spatialHash` continuam idênticos aos gabaritos oficiais. | Teste automatizado |
| CA-02 | Datasets 1 a 5: a lista completa de encontros com `spatialHash` é `deepStrictEqual` à de `allPairs` (quantidade, ids, timestamps, tipos, coordenadas, distâncias, ordem). | Teste automatizado (1 e 2) e script de comparação (3 a 5) |
| CA-03 | Testes sintéticos comparam as duas estratégias (força bruta como oráculo) com posições na mesma célula, em células vizinhas, sobre as bordas, grupos densos, coordenadas positivas e negativas, várias latitudes (incluindo altas latitudes e polos), o antimeridiano e distâncias abaixo, exatamente iguais e acima de 20 m. | Teste automatizado |
| CA-04 | I-01 e I-02 são verificados diretamente sobre os pares visitados, em grupos aleatórios reprodutíveis. | Teste automatizado |
| CA-05 | Benchmarks repetidos dos datasets 3 a 5, com as duas estratégias nas mesmas condições: tempo de leitura, de detecção e total; pares candidatos; cálculos de Haversine; memória. | Medição documentada no plano |
| CA-06 | Se `spatialHash` não mostrar benefício consistente, a causa é investigada e documentada, sem adoção forçada. | Revisão do plano |

## 6. Decisões

| ID | Questão | Decisão |
| -- | ------- | ------- |
| D1 | Grade em graus ou projeção métrica | Grade em graus com dimensões derivadas de limites inferiores da própria fórmula de Haversine (plano, seção 3). Ela é exata em qualquer latitude e trata o antimeridiano. |
| D2 | Tamanho da célula | Lado mínimo que garante RS-03 (20 m mais margem de segurança), para que só células vizinhas precisem ser examinadas (plano, seção 4). |
| D3 | Estratégia padrão | `allPairs` continua padrão de `detectEncounters` até a spec 004 decidir com base nos benchmarks. |

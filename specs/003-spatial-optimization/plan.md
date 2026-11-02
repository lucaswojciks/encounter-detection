# Plano técnico 003 — Otimização espacial

- **Status:** Implementado; varredura por latitude na seção 12
- **Spec:** [`spec.md`](spec.md)

## 1. Visão geral

```
TimestampGroup ──► spatialHash (PairSearch) ──► detectEncounters (spec 002, sem mudanças)
                   grade por grupo; visita só      distância exata, limiar < 20 m,
                   pares de células vizinhas       deduplicação, classificação, ordem
```

A estratégia nova só substitui a enumeração de pares. Distância, classificação,
unicidade, ordenação e saída continuam em `detectEncounters` e `toOutputEncounter`.

```ts
detectEncounters(group);               // referência (allPairs)
detectEncounters(group, spatialHash);  // otimizada
detectDatasetEncounters(groups, spatialHash);
```

## 2. Grade

Para cada grupo, os registros são distribuídos numa grade de **linhas** (latitude) e
**colunas** (longitude), em graus:

- **Altura das linhas** `h`: constante.
- **Largura das colunas** `W`: calculada por grupo a partir da maior `|latitude|` do
  grupo, `Φ`.

```
D' = 20 m × 1,001                                  (limiar + margem, seção 3.4)
h  = (D' / R) × 180/π                              ≈ 0,000180046°
w  = 2·asin( sin(D' / 2R) / cos Φ )  em graus      (se o argumento ≥ 1, não há limite)
C  = ⌊360 / w⌋ colunas;  se C < 3, C = 1           (uma única coluna)
W  = 360 / C                                       (≥ w; colunas iguais ao redor do globo)

linha(φ)  = ⌊(φ + 90) / h⌋
coluna(λ) = ⌊(λ + 180) / W⌋ mod C
chave     = linha × C + coluna
```

Cada registro é comparado apenas com os registros das **9 células** ao redor da sua
(linha ± 1, coluna ± 1 com volta módulo `C`). Com `C = 1`, só a própria coluna.

Exemplos de largura (dados oficiais: latitudes entre −33,75° e 5,27°):

| Φ | `w` | `w` em metros no paralelo Φ |
| - | --- | --------------------------- |
| 0° | ≈ 0,000180° | 20,02 m |
| 33,75° | ≈ 0,000217° | 20,02 m |
| 80° | ≈ 0,001037° | 20,02 m |
| > ≈ 89,9999° | `w > 120°` ou sem limite | uma coluna (`C < 3`) |

## 3. Garantia de ausência de falsos negativos

Notação: `φ₁, φ₂` são as latitudes e `Δλ` a diferença de longitude, em radianos;
`a = sin²(Δφ/2) + cos φ₁ cos φ₂ sin²(Δλ/2)`, `d = 2R·asin(√a)` (a fórmula da spec 002,
em aritmética exata). Seja `D'` o limiar com margem.

### 3.1 Linhas

`a ≥ sin²(Δφ/2)`, porque o segundo termo é não negativo (`|φ| ≤ π/2`, então
`cos φ ≥ 0`). Como `asin` é crescente e `|Δφ| ≤ π`:

```
d = 2R·asin(√a) ≥ 2R·asin(|sin(Δφ/2)|) = R·|Δφ|
```

Logo, `d < D'` ⇒ `|Δφ| < D'/R` ⇒ a diferença de latitude em graus é menor que `h`.
Dois valores com diferença menor que `h` caem em linhas `⌊x/h⌋` que diferem no
máximo em 1.

### 3.2 Colunas

`a ≥ cos φ₁ cos φ₂ sin²(Δλ/2) ≥ cos²Φ · sin²(Δλ/2)`, porque `|φ₁|, |φ₂| ≤ Φ ≤ 90°` e o
cosseno é decrescente em `[0, π/2]`. Então:

```
d < D'  ⇒  sin²(D'/2R) > a ≥ cos²Φ · sin²(Δλ/2)  ⇒  |sin(Δλ/2)| < sin(D'/2R) / cos Φ
```

`sin²(Δλ/2)` tem período 2π, então vale o mesmo para a diferença **circular**
`δλ ∈ [0, π]` (a distância angular entre as longitudes, contando a volta pelo
antimeridiano). Em `[0, π/2]` o seno é crescente, portanto
`δλ < 2·asin(sin(D'/2R) / cos Φ) = w`.

As colunas dividem os 360° em `C` partes iguais de largura `W ≥ w`. Duas longitudes
com diferença circular menor que `W` caem em colunas adjacentes (ou na mesma) módulo
`C`. Com `C ≥ 3`, as colunas `c − 1, c, c + 1` são distintas. Quando `C < 3` ou não há
limite (`sin(D'/2R) ≥ cos Φ`), usa-se uma única coluna e só as linhas filtram.

### 3.3 Conclusão

Se `d < D'`, os dois registros estão em linhas vizinhas **e** em colunas vizinhas,
logo um está numa das 9 células ao redor do outro e o par é visitado.

### 3.4 Ponto flutuante e margem

O detector decide com a distância **calculada** `d̂`, e os índices das células também
são calculados em ponto flutuante. A margem de 0,1 % em `D'` cobre as duas fontes:

- Para `d̂ < 20 m` implicar `d < D' = 20,02 m`, basta que o erro relativo do cálculo
  seja menor que 10⁻³. O erro das operações envolvidas é da ordem de 10⁻¹⁵ por
  operação. Uma verificação numérica com cerca de 5 milhões de pares aleatórios a
  menos de 25 m, em latitudes de −90° a 90° e cruzando o antimeridiano, encontrou
  razão máxima de 1 + 2,5·10⁻⁹ entre os lados das desigualdades 3.1 e 3.2: seis
  ordens de grandeza abaixo da margem.
- O erro no cálculo de `(φ + 90)/h` e `(λ + 180)/W` é da ordem de 10⁻¹⁴°, enquanto a
  folga da margem na célula é `h × 10⁻³ ≈ 1,8·10⁻⁷°`.
- `Φ` e `cos Φ` calculados com arredondamento são cobertos pela mesma margem.

A margem custa 0,1 % a mais de área por célula, sem efeito mensurável na quantidade
de candidatos.

## 4. Tamanho da célula

| Opção | Efeito | Decisão |
| ----- | ------ | ------- |
| Célula com lado `D'` (escolhida) | Vizinhança fixa de 3 × 3; a menor célula com essa propriedade. | **Adotada** |
| Células menores que `D'` | Exigiriam `⌈D'/lado⌉` anéis de vizinhos; mais consultas por registro sem reduzir o que importa. Com os dados esparsos (≤ 120 pessoas espalhadas pelo território brasileiro), quase toda célula tem 0 ou 1 registro. | Rejeitada |
| Células maiores (ex.: 100 m, 1 km) | Também corretas com 3 × 3, mas com mais candidatos por célula e o mesmo número de consultas. Sem ganho com dados esparsos. | Rejeitada |
| Grade fixa em graus (largura igual em todas as latitudes) | Para ser segura, a largura teria de ser dimensionada pela maior latitude possível (90°), o que daria uma única coluna. Com largura do equador, perderia pares em latitudes altas (falso negativo). | Rejeitada |
| Projeção métrica local (x, y em metros) | Exige escolher uma projeção e limitar a sua distorção; o antimeridiano e os polos continuam como casos especiais. | Rejeitada: a grade da seção 2 obtém a garantia direto da fórmula usada no detector. |
| Largura por linha (por latitude da linha) | Colunas mais estreitas no equador quando o grupo também tem pontos em latitude alta. Mais complexo, sem ganho com o espalhamento observado (Φ ≤ 33,75°, largura até 1,2× a do equador). | Adiada |

## 5. Algoritmo de visita

```ts
export const spatialHash: PairSearch = (records, visit) => {
  if (records.length < 2) return;
  const grid = gridFor(records);              // h, W, C do grupo
  const cells = new Map<number, number[]>();  // chave → índices em ordem do input
  // 1. indexação: linha e coluna de cada registro; índice adicionado à célula
  // 2. para cada i, em ordem: coletar j > i das 9 células vizinhas,
  //    ordenar os j (em geral 0 ou 1) e chamar visit(records[i], records[j])
};
```

Propriedades:

- **Visita única (I-02).** Com as 9 células distintas, cada `j` aparece numa única
  célula vizinha de `i`; o filtro `j > i` impede a visita invertida. Nenhum par é
  visitado duas vezes, e nenhum registro é visitado com ele mesmo.
- **Mesma ordem relativa de `allPairs` (RS-08).** Os pares saem ordenados por `i` e,
  dentro de cada `i`, por `j`. É exatamente a ordem de `allPairs` restrita aos
  candidatos. Por isso, a regra "primeira combinação vence" (R-10, ids repetidos) dá o
  mesmo resultado nas duas estratégias.
- **Sem estado entre grupos (RS-01).** `Map` e arrays são locais à chamada.
- **Busca de vizinhos** com nove consultas ao `Map` por registro. A alternativa da
  "meia vizinhança" (própria célula + 4 vizinhas) faz cerca de metade das consultas,
  mas visita os pares fora da ordem de `allPairs`; restaurar a ordem exigiria coletar
  e ordenar todos os candidatos do grupo. Fica como possível ajuste, se o benchmark
  mostrar que as consultas dominam.

## 6. Complexidade

Para um grupo com `n` registros e `k` pares candidatos:

| Recurso | `allPairs` | `spatialHash` |
| ------- | ---------- | ------------- |
| Cálculos de Haversine | `n(n − 1)/2` | `k` |
| Tempo | `O(n²)` | `O(n + k log k)` esperado (indexação, 9n consultas, ordenação dos candidatos de cada `i`) |
| Pior caso | `O(n²)` | `O(n²)` (todos na mesma célula: `k = n(n − 1)/2`) |
| Memória adicional | `O(1)` | `O(n)` (`Map`, listas das células, linha/coluna por registro) |

## 7. Alocações

- Por grupo: um `Map`, uma lista por célula ocupada, dois arrays de `n` números
  (linha e coluna de cada registro) e um buffer de candidatos reaproveitado entre os
  `i`.
- Alternativas sem `Map` (ordenar índices por chave e usar busca binária) ficam como
  candidatas apenas se o benchmark mostrar custo relevante de alocação ou GC.

## 8. Estratégia de validação

| Nível | Verificação | Oráculo |
| ----- | ----------- | ------- |
| Unitário | Dimensões da grade: `h`, `w(Φ)`, `C` e `W`; fallback de coluna única perto dos polos | Valores analíticos |
| Unitário | Casos construídos: mesma célula, células vizinhas (linha, coluna, diagonal), pontos sobre as bordas, antimeridiano, polos, coordenadas positivas e negativas | `allPairs` |
| Unitário | Limiar: pares abaixo, **exatamente igual** e acima de 20 m | `allPairs` e valor esperado |
| Propriedade | Grupos aleatórios reprodutíveis (gerador com semente), com aglomerados em várias latitudes e distâncias perto de 20 m: (1) encontros iguais aos de `allPairs`; (2) todo par com `d < 20` é visitado; (3) nenhum par é visitado duas vezes; (4) os pares visitados seguem a ordem de `allPairs` | `allPairs` |
| Aceitação | Datasets 1 e 2 com `spatialHash` iguais aos gabaritos | Gabaritos oficiais |
| Equivalência | Datasets 1 a 5: lista completa de encontros de cada grupo, `isDeepStrictEqual` entre as estratégias | `allPairs` |

## 9. Estratégia de benchmark

- **Mesmas condições:** mesmo build, mesma máquina, um processo por medição,
  alternando as estratégias (all, spatial, all, spatial, …) para diluir efeitos de
  cache e de temperatura.
- **Repetições:** 5 execuções por dataset e estratégia nos datasets 3, 4 e 5;
  reportar mediana, mínimo e máximo.
- **Separação de tempos:**
  - leitura isolada: script de medição da spec 001, nas mesmas condições;
  - detecção: soma das chamadas a `detectEncounters` (`performance.now()` por grupo);
  - total: do início ao fim do `for await`.
- **Contagens:** pares candidatos e cálculos de Haversine contados numa execução
  **separada**, com a estratégia instrumentada. A contagem não entra na medição de
  tempo, porque o callback extra por par distorceria `allPairs`.
- **Memória:** pico de heap, heap retido após `gc()` (execução separada com
  `--expose-gc`) e RSS máximo.
- **Critério:** a adoção depende de ganho consistente (todas as repetições) na
  detecção e no total. Sem isso, o resultado é documentado e `allPairs` continua sendo
  o padrão.

## 10. Riscos

- Grupos densos (muitas pessoas na mesma célula) degradam para `O(n²)`, sem perda de
  correção.
- A sobrecarga de indexação pode superar o ganho em grupos muito pequenos; o
  benchmark dos datasets 1 e 2 mostra esse efeito.
- A garantia depende de `haversineDistance` respeitar as desigualdades 3.1 e 3.2
  dentro da margem; uma mudança na fórmula exige rever a seção 3.

## 11. Resultados

Executado em 2026-11-02 com Node.js 24.19.0, Windows 11 Pro, AMD Ryzen 5 5600X,
16 GB de RAM e SSD, a partir do build de produção.

### 11.1 Equivalência

| Verificação | Resultado |
| ----------- | --------- |
| Testes automatizados (`npm test`) | 113 testes, todos passando |
| Gabaritos com `spatialHash` (datasets 1 e 2) | 4/4 e 6/6 idênticos, distâncias bit a bit, texto JSON igual ao arquivo oficial |
| `compare-strategies` nos datasets 1 a 5 | 0 grupos divergentes em 500, 1 250, 2 500, 6 667 e 12 500 grupos (4, 6, 10, 15 e 21 encontros) |
| Propriedade com 400 grupos aleatórios (semente fixa) | Encontros iguais, todos os pares < 20 m visitados, sem visitas repetidas, ordem de `allPairs` |
| Mutantes (alteração temporária do código) | Os testes falham com: largura de coluna do equador em todas as latitudes (4 falhas), sem volta no antimeridiano (1), só a própria célula (7), sem ordenação dos candidatos (6), sem o filtro `j > i` (10) e linhas com metade da altura (7) |

```
node dist/scripts/compare-strategies.js data/dataset1.txt … data/dataset5.txt
```

### 11.2 Candidatos e cálculos de Haversine

Contados com `measure-encounters --count`, numa execução separada da medição de
tempo:

| Dataset | Haversine com `allPairs` | Haversine com `spatialHash` | Cálculos evitados | Encontros |
| ------- | -----------------------: | --------------------------: | ----------------: | --------: |
| 1 | 22 500 | 6 | 22 494 | 4 |
| 2 | 237 500 | 6 | 237 494 | 6 |
| 3 | 1 950 000 | 14 | 1 949 986 | 10 |
| 4 | 11 800 590 | 16 | 11 800 574 | 15 |
| 5 | 39 500 000 | 22 | 39 499 978 | 21 |

Nos dados oficiais, quase todo candidato é um encontro, porque as pessoas estão
espalhadas por milhares de quilômetros e só se aproximam nos encontros.

### 11.3 Tempo

5 execuções por dataset e estratégia, cada uma num processo separado, alternando
leitura, `allPairs` e `spatialHash` em cada rodada. Valores: **mediana [mínimo–máximo]**
em segundos.

```
node dist/scripts/measure-dataset.js data/datasetN.txt                       # leitura
node dist/scripts/measure-encounters.js --search all|spatial data/datasetN.txt
```

| Dataset | Leitura isolada | Detecção `allPairs` | Detecção `spatialHash` | Total `allPairs` | Total `spatialHash` | Ganho na detecção | Ganho no total |
| ------- | --------------- | ------------------- | ---------------------- | ---------------- | ------------------- | ----------------- | -------------- |
| 1 | 0,013 [0,013–0,013] | 0,004 [0,004–0,005] | 0,005 [0,005–0,006] | 0,018 [0,018–0,018] | 0,019 [0,019–0,020] | nenhum | nenhum |
| 2 | 0,037 [0,036–0,038] | 0,016 [0,016–0,017] | 0,017 [0,016–0,017] | 0,054 [0,053–0,054] | 0,055 [0,054–0,056] | nenhum | nenhum |
| 3 | 0,110 [0,109–0,110] | 0,089 [0,088–0,090] | 0,044 [0,044–0,047] | 0,198 [0,195–0,202] | 0,153 [0,152–0,157] | 2,0× | 1,29× |
| 4 | 0,383 [0,381–0,390] | 0,511 [0,508–0,517] | 0,151 [0,150–0,152] | 0,899 [0,896–0,903] | 0,542 [0,538–0,546] | 3,4× | 1,66× |
| 5 | 0,931 [0,921–0,956] | 1,688 [1,686–1,695] | 0,345 [0,343–0,347] | 2,629 [2,605–2,636] | 1,279 [1,272–1,305] | 4,9× | 2,06× |

- Nos datasets 3, 4 e 5, o **pior** tempo de detecção com `spatialHash` é menor que o
  **melhor** com `allPairs`, então o ganho é consistente em todas as repetições.
- Nos datasets 1 e 2 (10 e 20 registros por grupo) não há ganho: o custo de montar o
  índice equivale ao de calcular 45 ou 190 distâncias.
- **Causa do ganho limitado a 4,9×**, mesmo com 99,9999 % menos distâncias no dataset
  5: com `spatialHash`, o custo passa a ser a indexação (um `Map`, listas por célula e
  9 consultas por registro). São cerca de 0,35 µs por registro, contra 1,7 µs por
  registro da força bruta com 80 registros por grupo. O ganho cresce com o tamanho do
  grupo, porque `allPairs` é quadrático e `spatialHash` é linear: 2,0×, 3,4× e 4,9×
  para 40, 60 e 80 registros.
- Com `spatialHash`, a leitura (≈0,93 s no dataset 5) passa a dominar o tempo total.
  Otimizar mais a detecção reduziria no máximo ≈27 % do total do dataset 5. As
  alternativas das seções 5 e 7 (meia vizinhança, índice sem `Map`) não foram
  implementadas.

### 11.4 Memória

| Dataset | Estratégia | Pico de heap (mediana) | Heap retido após `gc()` | RSS máximo (mediana) |
| ------- | ---------- | ---------------------: | ----------------------: | -------------------: |
| 3 | `allPairs` | 9,6 MiB | 5,1 MiB | 52,0 MiB |
| 3 | `spatialHash` | 9,4 MiB | 5,1 MiB | 54,4 MiB |
| 4 | `allPairs` | 11,9 MiB | 5,2 MiB | 60,6 MiB |
| 4 | `spatialHash` | 12,0 MiB | 5,2 MiB | 61,0 MiB |
| 5 | `allPairs` | 15,4 MiB | 5,2 MiB | 67,1 MiB |
| 5 | `spatialHash` | 20,4 MiB | 5,2 MiB | 76,6 MiB |

- O heap **retido** é igual nas duas estratégias: o índice é descartado ao fim de cada
  grupo (RS-01, I-03).
- O pico de heap e o RSS maiores no dataset 5 com `spatialHash` vêm do lixo
  temporário (um `Map` e listas por grupo) acumulado entre coletas. Não crescem com o
  tamanho do arquivo.

### 11.5 Conclusão

`spatialHash` é equivalente a `allPairs` em todos os testes e datasets e reduz de forma
consistente o tempo de detecção a partir de 40 registros por grupo. Os datasets 6 e 7
(100 e 120 registros por grupo) não foram medidos. Pela complexidade, o ganho tende a
ser maior neles, mas isso não foi verificado. **Recomendação para a spec 004:** usar
`spatialHash` no processamento, mantendo `allPairs` como referência nos testes.
`detectEncounters` continua com `allPairs` como padrão (D3) até essa decisão.

## 12. Varredura por latitude (spec, seção 7)

### 12.1 Algoritmo

```ts
export const latitudeSweep: PairSearch = (records, visit) => {
  // 1. latitudes num Float64Array; índices 0..n-1 num Int32Array, ordenados por latitude
  // 2. para cada p, comparar com q = p+1, p+2, ... enquanto lat[q] − lat[p] ≤ h;
  //    o par entra como candidato se passar no filtro de longitude (12.2)
  // 3. candidatos codificados como i·n + j (i < j), ordenados numericamente
  // 4. visit(records[i], records[j]) na ordem resultante
};
```

Não há grade, `Map` nem consultas a células. A faixa de latitude de cada registro
é percorrida em ordem até o primeiro registro fora dela, o que, com os registros
espalhados pelo território, quase sempre acontece na primeira comparação.

### 12.2 Correção

As condições são as necessárias da seção 3, aplicadas a cada par em vez de a uma
grade:

- **Latitude (3.1).** `d < D'` ⇒ `|Δφ| < D'/R`, ou seja, diferença de latitude em
  graus menor que `h`. A varredura só descarta pares com diferença **maior** que
  `h`. Como os índices estão ordenados por latitude, todo par com diferença `≤ h`
  aparece no laço interno antes da interrupção.
- **Longitude (3.2).** `d < D'` ⇒ `cos Φ · |sin(Δλ/2)| < sin(D'/2R)`, com `Φ` a maior
  `|latitude|` do par. Diferente da grade, que usa o `Φ` do grupo inteiro, aqui `Φ` é
  calculado por par, o que dá um filtro igual ou mais estreito com a mesma
  garantia.
  - **Antimeridiano.** `|sin(Δλ/2)|` tem período 360° em `Δλ`, então a diferença
    direta (até 360°) e a circular dão o mesmo valor: 179,99995° e −179,99995°
    (`Δλ` = 359,9999°) são tratados como vizinhos sem caso especial.
  - **Polos.** Perto de ±90°, `cos Φ ≈ 0` (`cos(π/2)` em ponto flutuante é
    ≈ 6·10⁻¹⁷), e qualquer longitude passa no filtro. É o equivalente à coluna
    única da grade.
  - **Coordenadas negativas.** As desigualdades usam diferenças e valores
    absolutos, sem dependência de sinal.
- **Ponto flutuante.** A margem de 0,1 % de `D'` (seção 3.4) cobre os erros das
  diferenças em graus e de `sin` e `cos`. Esses erros são da ordem de 10⁻¹⁶
  relativo, contra uma folga de 10⁻³.
- **Ordem e visita única (RS-08, I-01, I-02).** Cada par `{i, j}` aparece uma única
  vez no laço (de `min(p, q)` para `max(p, q)` na ordem de latitude). É codificado
  como `i·n + j` com `i < j`, que é único e cuja ordem numérica é a ordem
  lexicográfica de `(i, j)`, a de `allPairs`. A codificação é exata enquanto
  `n² < 2⁵³`, ou seja, para grupos com menos de ≈9,4·10⁷ registros.

### 12.3 Complexidade

Para um grupo com `n` registros, `b` pares dentro da faixa de latitude e `k`
candidatos:

| Recurso | `spatialHash` | `latitudeSweep` |
| ------- | ------------- | --------------- |
| Tempo | `O(n + k log k)` esperado (indexação com `Map`, 9n consultas) | `O(n log n + b + k log k)` (ordenação de `n` índices numéricos, varredura das faixas) |
| Pior caso | `O(n²)` (todos na mesma célula) | `O(n²)` (todos na mesma faixa de latitude) |
| Memória adicional | `O(n)` (`Map`, listas, dois `Int32Array`) | `O(n)` (`Float64Array`, `Int32Array`, candidatos) |

Com `n` até 120, o `O(n log n)` da ordenação de números é bem mais barato que o
`Map` e as listas por célula.

### 12.4 Decisões de implementação

| Escolha | Alternativa | Motivo |
| ------- | ----------- | ------ |
| Latitudes e índices em `Float64Array` / `Int32Array` | `Array` de índices ordenado consultando `records[i].latitude` | Numa medição exploratória (2 execuções, só a detecção do dataset 6, os mesmos 27 pares visitados), 0,66 s contra 1,16–1,28 s. |
| `Φ` por par | `Φ` do grupo, como na grade | Filtro igual ou mais estreito, com o mesmo argumento, e sem passada extra para calcular `Φ`. O custo do `sin`/`cos` só existe para pares dentro da faixa de latitude. |
| Ordenar os candidatos | Visitar na ordem de latitude | A ordem de `allPairs` é exigida por RS-08 (regra de ids repetidos da spec 002). Há em geral 0 ou 1 candidato por grupo. |
| Manter `spatialHash` | Remover | A equivalência foi comprovada, mas a estratégia continua sendo uma alternativa documentada e testada (`--search spatial`), e os testes de propriedade passam a comparar duas otimizações independentes com a força bruta. |

### 12.5 Validação

| Verificação | Resultado |
| ----------- | --------- |
| Suíte de CA-03/CA-04 (casos construídos e 400 grupos aleatórios) executada para `spatialHash` e `latitudeSweep` | Passa para as duas estratégias |
| Testes próprios (CA-08) | Passam |
| Gabaritos (datasets 1 e 2) com `latitudeSweep` | Idênticos, distâncias bit a bit e texto JSON igual ao arquivo oficial |
| `compare-strategies` nos datasets 1 a 7, **todos** os grupos | 0 grupos divergentes, tanto para `spatialHash` quanto para `latitudeSweep`, em 500, 1 250, 2 500, 6 667, 12 500, 80 000 e 100 000 grupos (4, 6, 10, 15, 21, 27 e 35 encontros) |
| CLI com `--search sweep`, `spatial` e `all` nos datasets 1 a 7 | Os 21 arquivos idênticos byte a byte a `outputs/encontros-datasetN.json` |

Mutantes (alteração temporária do código compilado, uma por vez, com os testes de
busca):

| Mutação | Testes que falham |
| ------- | ----------------: |
| Faixa de latitude com metade de `h` | 9 |
| Longitude sem periodicidade (`|Δλ/2|` no lugar de `|sin(Δλ/2)|`) | 3 |
| Menor `|latitude|` do par no lugar da maior | 2 |
| Sem ordenação dos candidatos | 8 |
| Pares na ordem de latitude, sem normalizar `i < j` | 10 |

### 12.6 Benchmark (CA-11)

Mesmas condições da spec 001, plano, seção 12.6: Node.js 24.19.0, Windows 11 Pro,
AMD Ryzen 5 5600X; 5 rodadas alternadas; um processo por medição. **Anterior** é
`spatialHash` no build da `main` (`3a521f6`). **Otimizada** é `latitudeSweep` nesta
branch. É só o tempo de `detectEncounters` (soma por grupo), sem leitura:

```
node dist/scripts/measure-encounters.js --search spatial|sweep data/datasetN.txt
```

| Dataset | Registros por timestamp | `spatialHash` (anterior) | `latitudeSweep` | Redução | Fator |
| ------- | ----------------------: | ------------------------ | --------------- | ------: | ----: |
| 1 | 10 | 0,005 [0,005–0,006] | 0,002 [0,002–0,002] | 60 % | 2,5× |
| 2 | 20 | 0,018 [0,016–0,018] | 0,004 [0,004–0,006] | 78 % | 4,5× |
| 3 | 40 | 0,046 [0,045–0,059] | 0,012 [0,010–0,014] | 74 % | 3,8× |
| 4 | 60 | 0,158 [0,155–0,162] | 0,029 [0,029–0,040] | 82 % | 5,4× |
| 5 | 80 | 0,368 [0,353–0,444] | 0,072 [0,067–0,083] | 80 % | 5,1× |
| 6 | 100 | 2,843 [2,775–3,026] | 0,535 [0,508–0,681] | 81 % | 5,3× |
| 7 | 120 | 4,316 [4,206–4,655] | 0,784 [0,741–0,865] | 82 % | 5,5× |
| **Soma das medianas** | | **7,754** | **1,438** | **81 %** | **5,4×** |

- Em todos os datasets, a pior execução de `latitudeSweep` foi mais rápida que a
  melhor de `spatialHash`.
- Ao contrário de `spatialHash`, a varredura já ganha nos datasets 1 e 2 (grupos de 10
  e 20 registros), onde a grade não ganhava da força bruta (seção 11.3).
- Os encontros são os mesmos nas 70 execuções (4, 6, 10, 15, 21, 27 e 35).
- Cálculos de Haversine com `latitudeSweep` (`measure-encounters --count`, execução
  separada): 4, 6, 12, 15, 21, 27 e 36 nos datasets 1 a 7, contra 6, 6, 14, 16 e 22
  de `spatialHash` nos datasets 1 a 5 (seção 11.2). O filtro de longitude por par é
  igual ou mais estreito que a coluna da grade.
- A memória é tratada junto com a aplicação completa, no README e na spec 001, plano,
  seção 12.6. Sem o `Map` e as listas por grupo, sobra menos lixo temporário.

### 12.7 Decisão

`latitudeSweep` cumpre RS-01 a RS-10 com o mesmo argumento de correção, é equivalente
a `allPairs` em todos os testes e em todos os timestamps dos sete datasets, e reduz a
detecção de forma consistente em todos os tamanhos de grupo. **Adotada como padrão
da CLI e de `processDataset` (D4).** `spatialHash` continua disponível e testado
como alternativa, e `allPairs` continua sendo a referência.

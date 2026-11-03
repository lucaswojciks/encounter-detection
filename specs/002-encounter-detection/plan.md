# Plano técnico 002 — Detecção de encontros

- **Status:** Implementado
- **Spec:** [`spec.md`](spec.md)

O algoritmo descrito é a **implementação de
referência**: simples, exata e fácil de verificar. Ele é o critério de correção da
otimização espacial da spec 003, que deve produzir exatamente a mesma saída.

## 1. Visão geral

```
readDataset (spec 001) ──► detectEncounters(group) ──► toOutputEncounter ──► escrita (spec 004)
AsyncGenerator<TimestampGroup>   comparação de pares       objeto no formato
                                 + classificação           do gabarito
```

Responsabilidades separadas:

| Etapa | Responsabilidade | Depende de |
| ----- | ---------------- | ---------- |
| Distância | Haversine exata | nada |
| Classificação | Tipo de um par a partir dos dois registros | tipos da spec 001 |
| Busca de pares | Enumerar os pares candidatos de um grupo (referência: todos os pares `i < j`; spec 003: spatial hashing) | tipos da spec 001 |
| Detecção | Validar cada candidato com a distância exata e o limiar, deduplicar, classificar e ordenar | distância, classificação, busca |
| Fluxo | Aplicar a detecção a cada grupo de um `AsyncIterable` | detecção |
| Mapeamento de saída | Converter o encontro interno no objeto do gabarito | nada além do tipo `Encounter` |

A serialização para texto (`JSON.stringify`, arquivo, CLI) fica na spec 004.

## 2. Estrutura de arquivos

```
src/encounters/
├── types.ts            # EncounterType, Encounter
├── haversine.ts        # EARTH_RADIUS_METERS, haversineDistance()
├── classify.ts         # classifyEncounter(a, b)
├── pair-search.ts      # PairSearch, allPairs (estratégia de referência)
├── detect.ts           # ENCOUNTER_DISTANCE_METERS, detectEncounters(group, search)
├── detect-stream.ts    # detectDatasetEncounters(groups)
└── output.ts           # OutputEncounter, toOutputEncounter()
test/encounters/        # testes unitários, de integração e de aceitação
```

## 3. Representação

```ts
export type EncounterType = "generico" | "faccao" | "protetiva";

export interface Encounter {
  readonly type: EncounterType;
  readonly timestamp: string;
  readonly first: LocationRecord;    // registro do menor id
  readonly second: LocationRecord;   // registro do maior id
  readonly distanceMeters: number;
}

export interface OutputEncounter {   // formato do gabarito, chaves nesta ordem
  readonly tipo: EncounterType;
  readonly monitoradosEncontro: readonly [number, number];
  readonly timestamp: string;
  readonly posicoes: Readonly<Record<string, { readonly lat: number; readonly lon: number }>>;
  readonly distanciaMetros: number;
}
```

| Escolha | Alternativa | Motivo |
| ------- | ----------- | ------ |
| `Encounter` guarda referências aos dois registros | Copiar ids e coordenadas | Não aloca nada além do objeto do encontro e preserva os valores originais. Os registros são imutáveis (`readonly`). |
| `first`/`second` já ordenados por id | Ordenar no mapeamento de saída | A ordem crescente vira um invariante do tipo, e a ordenação O-02 fica direta. |
| Mapeamento separado (`toOutputEncounter`) | Detector produz o formato do gabarito | Mantém o domínio em nomes do código e isola o formato externo. A ordem das chaves fica num único lugar. |
| Valores de `tipo` iguais aos do gabarito | Enum interno + tradução | Os três valores já são o vocabulário do domínio; uma tradução não acrescenta nada. |

## 4. Haversine e precisão numérica

A análise (seção 3.3) testou 36 variantes algebricamente equivalentes. Só uma
reproduz bit a bit as 10 distâncias oficiais. Essa é a implementação adotada:

```ts
export const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const sinHalfDeltaLat = Math.sin(toRadians(lat2 - lat1) / 2);
  const sinHalfDeltaLon = Math.sin(toRadians(lon2 - lon1) / 2);
  const a =
    sinHalfDeltaLat ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * sinHalfDeltaLon ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
}
```

Detalhes que mudam o resultado no último bit e devem ser mantidos:

- A diferença é calculada **em graus** e só depois convertida (`toRadians(lat2 − lat1)`).
  Converter cada coordenada e subtrair erra em até 7,9·10⁻¹⁰ m.
- A conversão é `(x * Math.PI) / 180`. Usar `x * (Math.PI / 180)` ou `x / 180 * Math.PI`
  muda 1 a 3 dos 10 valores.
- O final é `2 * R * asin(√a)`. A forma `atan2(√a, √(1 − a))` muda 1 dos 10 valores.
- Cada sin² é **um termo** multiplicado pelo produto dos cossenos:
  `(cos₁ · cos₂) · sin²(Δλ/2)`. Elevar ao quadrado com `x * x`, `x ** 2` ou
  `Math.pow(x, 2)` dá o mesmo valor (testado em 10⁶ valores aleatórios); a
  implementação usa `** 2`.
- **Correção feita na implementação:** a primeira versão deste plano expandia o
  termo como `cos₁ * cos₂ * s * s`, que o JavaScript associa como
  `((cos₁ · cos₂) · s) · s`. Essa forma também reproduz os 10 gabaritos, mas difere
  em 1 ULP em 4 de 67 pares a menos de 40 m nos datasets 1–5 (por exemplo, par 31–43
  do dataset 4: 10.584413373886987 contra 10.584413373886989). Os gabaritos não
  distinguem as duas formas. A escolhida é a variante validada na análise (seção 3.3)
  e corresponde à notação da fórmula, com sin² como um único termo. Um teste fixa essa
  escolha. Outra forma, `cos₁ · (cos₂ · sin²)`, erra 1 dos 10 gabaritos.

Propriedades:

- **Simetria:** trocar os pontos dá o mesmo resultado bit a bit (verificado nos 10
  casos; `sin(−x) = −sin(x)` e o produto de cossenos é comutativo). Mesmo assim, a
  detecção sempre passa o registro de menor id primeiro, para que o resultado não
  dependa da ordem do input.
- **Determinismo:** o V8 implementa `Math.sin`, `Math.cos`, `Math.asin` e
  `Math.sqrt` sem depender da plataforma. O mesmo Node produz o mesmo `double`.
- **Igualdade exata nos testes:** os testes de aceitação comparam distâncias com
  `===`. Uma tolerância esconderia regressões na fórmula; a diferença entre variantes
  (≤ 10⁻⁹ m) não muda nenhum encontro nos dados, mas muda a saída.
- **Limiar:** comparação `distance < 20`, sem arredondamento prévio (R-04).

## 5. Classificação

```ts
export function classifyEncounter(a: LocationRecord, b: LocationRecord): EncounterType {
  if (a.restrictedIds.includes(b.id) || b.restrictedIds.includes(a.id)) return "protetiva";
  if (a.faction !== null && a.faction === b.faction) return "faccao";
  return "generico";
}
```

- **Detalhe de implementação (D1):** a função precisa devolver um único tipo, então
  as condições são verificadas numa ordem fixa: R-05, depois R-06. A ordem segue
  apenas a numeração da spec. **Não é uma regra de negócio**, não foi validada pelos
  gabaritos e não tem teste que a trave como requisito: um par que satisfaça as duas
  condições não ocorre em nenhum dataset oficial. A ordem também mantém a função
  determinística.
- `includes` em arrays de 1 elemento (todos os dados observados) é mais barato que
  montar um `Set` por registro. A classificação só roda para pares abaixo de 20 m,
  que são raros (no máximo 21 em 1 milhão de registros nos datasets 1–5), então o
  custo é desprezível.

## 6. Detecção de referência

A detecção é dividida em duas partes, para que a spec 003 troque apenas a busca:

1. **Estratégia de busca** (`PairSearch`): enumera os pares **candidatos** de um grupo.
2. **Validação** (`detectEncounters`): para cada candidato, aplica R-02, a distância
   exata, o limiar, a deduplicação e a classificação, e no fim ordena.

```ts
/** Calls `visit` for each candidate pair of records in the group. */
export type PairSearch = (
  records: readonly LocationRecord[],
  visit: (a: LocationRecord, b: LocationRecord) => void,
) => void;

/** Reference strategy: every pair i < j, in input order. */
export const allPairs: PairSearch = (records, visit) => {
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) visit(records[i], records[j]);
  }
};

export const ENCOUNTER_DISTANCE_METERS = 20;

export function detectEncounters(group: TimestampGroup, search: PairSearch = allPairs): Encounter[] {
  const encounters: Encounter[] = [];
  const seenPairs = new Set<string>();             // R-08 / R-10
  search(group.records, (a, b) => {
    if (a.id === b.id) return;                     // R-02
    const [first, second] = a.id < b.id ? [a, b] : [b, a];
    const distance = haversineDistance(first.latitude, first.longitude, second.latitude, second.longitude);
    if (!(distance < ENCOUNTER_DISTANCE_METERS)) return;   // R-04
    const key = `${first.id}:${second.id}`;
    if (seenPairs.has(key)) return;                // primeira combinação vence (R-10)
    seenPairs.add(key);
    encounters.push({ type: classifyEncounter(first, second), timestamp: group.timestamp,
                      first, second, distanceMeters: distance });
  });
  return encounters.sort(byIds);                   // O-02
}
```

Decisões:

- **Callback em vez de gerador para a busca.** Um gerador que devolve uma tupla por
  par alocaria um objeto por distância calculada (39,5 milhões no dataset 5). O
  callback não aloca nada por par. A troca da estratégia continua sendo um parâmetro.
- **Referência = todos os pares `i < j`.** Cada par de posições é avaliado uma vez, e o
  par `(i, j)` nunca é visitado como `(j, i)`. Sem ids repetidos, não há duplicatas
  por construção.
- **Distância exata sempre valida o candidato.** Uma estratégia de busca só pode
  **reduzir** os candidatos. A decisão de encontro é sempre da fórmula exata
  (spec 003, RS-05: candidatos espaciais são sempre validados pela distância exata).
- **Deduplicação só sobre encontros.** O `Set` recebe uma chave apenas quando a
  distância está abaixo do limiar, então fica vazio na maioria dos grupos. Ele garante
  R-08 quando a spec 001 entrega ids repetidos, e também quando uma estratégia da
  spec 003 visitar o mesmo par mais de uma vez (por exemplo, por células vizinhas).
  A alternativa de verificar ids únicos antes da enumeração exigiria montar um `Set`
  com todos os ids de cada grupo, um custo `O(n)` por grupo mesmo quando não há
  encontro.
- **Primeira combinação vence (R-10).** Com ids repetidos, a referência visita as
  combinações na ordem do input, e a primeira abaixo do limiar é a registrada. Uma
  estratégia que visite os pares em outra ordem pode escolher outra combinação nesse
  caso; a spec 003 deve preservar essa ordem ou documentar a diferença. O caso não
  ocorre nos dados oficiais.
- **Ordenação O-02.** Ordenar os encontros de um grupo (poucos) por
  `(first.id, second.id)`, numericamente, torna a saída independente da ordem de
  enumeração.
- **`!(distance < 20)`** também rejeita `NaN`, que não ocorre com coordenadas
  validadas pela spec 001.
- **Síncrona e pura.** `detectEncounters` não faz I/O nem guarda estado entre
  chamadas, e por isso é testável com grupos montados à mão.

### Estruturas para evitar trabalho desnecessário

- A classificação, a chave do par e a alocação do `Encounter` só acontecem para
  pares abaixo do limiar. O custo dominante é a distância.
- Nenhuma estrutura é montada por grupo além do array de saída e do `Set`, que fica
  vazio na maioria dos grupos.
- Duas otimizações candidatas ficam **adiadas para a spec 003**, com benchmark e
  comparação contra esta referência:
  1. Pré-calcular `cos(toRadians(lat))` uma vez por registro. O valor é bit a bit
     igual ao calculado dentro da fórmula, mas muda a estrutura do código.
  2. Descartar pares pela diferença de latitude antes da fórmula. Exige uma margem
     conservadora para nunca rejeitar um encontro verdadeiro.

## 7. Integração com a spec 001

```ts
export async function* detectDatasetEncounters(
  groups: AsyncIterable<TimestampGroup>,
): AsyncGenerator<Encounter, void, undefined> {
  for await (const group of groups) {
    yield* detectEncounters(group);
  }
}

// uso
for await (const encounter of detectDatasetEncounters(readDataset(path))) { … }
```

- Um grupo por vez, sem estado entre grupos (RI-01). A contrapressão da spec 001 se
  mantém: o próximo grupo só é lido quando os encontros do atual foram consumidos
  (RI-02).
- Erros de entrada (`DatasetError`) se propagam ao consumidor pelo
  `for await`.

## 8. Mapeamento de saída

```ts
export function toOutputEncounter(encounter: Encounter): OutputEncounter {
  const { first, second } = encounter;
  return {
    tipo: encounter.type,
    monitoradosEncontro: [first.id, second.id],
    timestamp: encounter.timestamp,
    posicoes: {
      [first.id]: { lat: first.latitude, lon: first.longitude },
      [second.id]: { lat: second.latitude, lon: second.longitude },
    },
    distanciaMetros: encounter.distanceMeters,
  };
}
```

- A ordem das chaves do objeto literal é a ordem do gabarito.
- Em `posicoes`, chaves numéricas são enumeradas em ordem crescente pelo JavaScript,
  o que coincide com `monitoradosEncontro` [4.9c].
- Números não são formatados nem arredondados; `JSON.stringify` (spec 004) produz a
  menor representação que reconstrói o mesmo `double`, como nos gabaritos.

## 9. Complexidade

Para um grupo com `n` registros e `k` encontros:

| Recurso | Custo |
| ------- | ----- |
| Distâncias calculadas | `n(n − 1)/2` |
| Tempo | `O(n² + k log k)` |
| Memória adicional | `O(k)` (array de saída e `Set`), sem cópia dos registros |

Para um arquivo com `G` grupos de `n` registros: tempo `O(G · n²)` e memória `O(n + k)`
(o maior grupo da spec 001 mais os encontros de um grupo).

Volume de cálculos de distância nos datasets oficiais (contagem exata a partir das
estatísticas da análise; datasets 6 e 7 estimados):

| Dataset | Grupos | Registros por grupo | Pares por grupo | Distâncias calculadas |
| ------- | -----: | ------------------: | --------------: | --------------------: |
| 1 | 500 | 10 | 45 | 22 500 |
| 2 | 1 250 | 20 | 190 | 237 500 |
| 3 | 2 500 | 40 | 780 | 1 950 000 |
| 4 | 6 667 | 60 | 1 770 | 11 800 590 |
| 5 | 12 500 | 80 | 3 160 | 39 500 000 |
| 6 | ≈80 000 | 100 | 4 950 | ≈396 000 000 |
| 7 | ≈100 000 | 120 | 7 140 | ≈714 000 000 |

O custo cresce com o quadrado do grupo. O tempo real será medido na implementação
(T09), e não estimado aqui. A spec 003 deve reduzir o número de distâncias
calculadas sem mudar a saída.

## 10. Estratégia de testes

Todos com `node:test` e `node:assert/strict`.

| Nível | Alvo | Dados |
| ----- | ---- | ----- |
| Unitário | `haversineDistance`: 10 distâncias oficiais com `===` nos dois sentidos (CA-03); distância zero; 1° de latitude = `R·π/180` | Posições de `respostas1.json` e `respostas2.json` |
| Unitário | Limiar (CA-04): pares geométricos logo abaixo e logo acima de 20 m, construídos no teste ajustando a latitude até a fórmula cruzar o limiar; `ENCOUNTER_DISTANCE_METERS === 20` | Sintético |
| Unitário | `classifyEncounter` (CA-08): mesma facção; facções diferentes; facção × sem facção; restrição listada por `a`, por `b`, pelos dois; pessoa com restrição × terceiro | Registros sintéticos |
| Unitário | `detectEncounters`: R-02 e R-10 com ids repetidos (CA-06); ordem O-02; grupo de 0, 1 e 2 registros; independência da ordem do input | Grupos sintéticos |
| Unitário | `toOutputEncounter` (CA-09): ordem das chaves (`Object.keys`), ids crescentes, valores sem alteração | Sintético |
| Integração | `detectDatasetEncounters` sobre `groupByTimestamp`: registros próximos em timestamps diferentes (CA-05); par próximo em 3 timestamps consecutivos (CA-07); contrapressão (CA-10) | Linhas sintéticas |
| Aceitação | Datasets oficiais 1 e 2: `readDataset → detectDatasetEncounters → toOutputEncounter` comparado com `deepStrictEqual` aos gabaritos, incluindo ordem e distâncias exatas (CA-01, CA-02) | `test/fixtures/official/` |
| Manual | Datasets 3–5: quantidades 10, 15 e 21 e o par 28–31 em três timestamps (CA-07, CA-11); tempo e memória diagnósticos | `data/` local |

**Independência da referência nos testes de aceitação:** o gabarito oficial é a
referência dos datasets 1 e 2. Para os datasets 3–5 (sem gabarito), a referência é a
força bruta da análise exploratória, escrita separadamente e fora do código de
produção.

**Medição:** `scripts/measure-encounters.ts` complementa o script da spec 001,
contando encontros e distâncias calculadas e medindo tempo de detecção, tempo total e
memória. Resultados na seção 12.

## 11. Riscos

- **Desempenho nos datasets 6 e 7:** 396 e 714 milhões de distâncias. É a motivação
  da spec 003; esta referência não tem meta de tempo.
- **Classificação simultânea (D1):** se o enunciado vier a definir o tipo de um par
  que satisfaça R-05 e R-06, só `classifyEncounter` e seus testes mudam.
- **Dependência da fórmula exata:** a igualdade com os gabaritos depende da variante
  da seção 4. Qualquer refatoração da função precisa manter os testes de CA-03.
- **Último bit nos datasets sem gabarito:** duas associações do produto reproduzem os
  10 gabaritos e diferem em 1 ULP em alguns pares dos datasets 4 e 5 (seção 4). Se
  houver um gabarito oficial para os datasets 3–7, ele pode mostrar que a forma
  escolhida não é a do avaliador. O conjunto de encontros não muda: nenhum par dos
  datasets 1–5 está a menos de 1 ULP de 20 m.

## 12. Resultados da implementação

### 12.1 Validação com os gabaritos (CA-01 a CA-03)

Pipeline `readDataset → detectDatasetEncounters → toOutputEncounter`, em testes
automatizados:

| Dataset | Encontros oficiais | Detectados | Iguais (`deepStrictEqual`, na ordem) | Distâncias bit a bit | `JSON.stringify(lista, null, 2)` igual ao arquivo oficial |
| ------- | -----------------: | ---------: | ------------------------------------ | -------------------- | --------------------------------------------------------- |
| 1 | 4 | 4 | 4/4 | 4/4 | sim |
| 2 | 6 | 6 | 6/6 | 6/6 | sim |

### 12.2 Datasets sem gabarito (CA-07, CA-11)

Comparação com a força bruta independente da análise exploratória (script separado,
fora do repositório), linha a linha, por timestamp, par, tipo e distância:

| Dataset | Encontros | `generico` | `faccao` | `protetiva` | Igual à referência independente |
| ------- | --------: | ---------: | -------: | ----------: | ------------------------------- |
| 1 | 4 | 2 | 1 | 1 | sim |
| 2 | 6 | 3 | 2 | 1 | sim |
| 3 | 10 | 5 | 3 | 2 | sim |
| 4 | 15 | 7 | 5 | 3 | sim |
| 5 | 21 | 10 | 7 | 4 | sim |

O par 28–31 do dataset 3 gera três encontros, em 01:00:30 (12,87 m), 01:00:35
(8,70 m) e 01:00:40 (13,30 m), como define R-09.

### 12.3 Medição diagnóstica (T09)

Medição **diagnóstica**, sem metas. Executada em 2026-11-02 com Node.js 24.19.0,
Windows 11 Pro, AMD Ryzen 5 5600X, 16 GB de RAM e SSD. Cada execução roda em um
processo separado:

```
npm run build
node dist/scripts/measure-encounters.js data/datasetN.txt
node --expose-gc dist/scripts/measure-encounters.js data/datasetN.txt   # heap retido
```

- **Detecção:** soma do tempo das chamadas a `detectEncounters`, medido com
  `performance.now()` por grupo.
- **Total:** leitura, parsing, agrupamento e detecção, do início ao fim do
  `for await`.

| Dataset | Distâncias calculadas | Detecção | Total | Distâncias/s (detecção) | Pico de heap | RSS máximo |
| ------- | --------------------: | -------: | ----: | ----------------------: | -----------: | ---------: |
| 1 | 22 500 | 0,005 s | 0,018 s | ≈4,9 milhões | 5,6 MiB | 45,9 MiB |
| 2 | 237 500 | 0,016 s | 0,052 s | ≈14,6 milhões | 6,8 MiB | 48,4 MiB |
| 3 | 1 950 000 | 0,087 s | 0,194 s | ≈22,3 milhões | 8,3 MiB | 52,1 MiB |
| 4 | 11 800 590 | 0,506 s | 0,893 s | ≈23,3 milhões | 10,7 MiB | 60,2 MiB |
| 5 | 39 500 000 | 1,683–1,701 s (3 execuções) | 2,586–2,622 s | ≈23,2–23,5 milhões | 13,6–13,7 MiB | 61,1–73,5 MiB |

- Heap retido após `gc()` (com `--expose-gc`): 5,0 MiB no dataset 3 e 5,2 MiB no
  dataset 5. A memória continua limitada com a detecção (RI-03).
- Leitura isolada do dataset 5 (script da spec 001) na mesma sessão: 0,915 s, coerente
  com a diferença entre o total e a detecção (≈0,92 s).
- Nos datasets pequenos, o throughput é menor por causa do aquecimento do JIT.
- Os datasets 6 e 7 não foram medidos (não estão disponíveis localmente). Pela tabela
  da seção 9, eles exigem cerca de 10 e 18 vezes mais distâncias que o dataset 5. Não
  há medição que confirme a extrapolação.

### 12.4 Notas de implementação

- `PairSearch` é um callback `(records, visit) => void`; `allPairs` é a estratégia de
  referência, e `detectEncounters(group, search = allPairs)` aceita outra estratégia
  sem mudar distância, limiar, deduplicação, classificação ou ordenação.
- `detectDatasetEncounters(groups, search = allPairs)` repassa a estratégia.
- Um teste verifica que a fórmula retorna exatamente 20 para dois pontos encontrados
  por bisseção, e que esse par **não** é encontro. Com `<=` no lugar de `<`, dois
  testes falham (verificado com a alteração temporária do código).
- A classificação de um par que satisfaça R-05 e R-06 não tem teste, por decisão D1:
  a ordem de verificação é um detalhe de implementação, não um requisito.

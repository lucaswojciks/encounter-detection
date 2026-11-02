# Plano técnico 002 — Detecção de encontros

- **Status:** Em revisão
- **Spec:** [`spec.md`](spec.md)

Nada aqui foi implementado. O algoritmo descrito é a **implementação de
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
| Detecção | Enumerar pares de um grupo, aplicar o limiar, deduplicar e ordenar | distância, classificação |
| Fluxo | Aplicar a detecção a cada grupo de um `AsyncIterable` | detecção |
| Mapeamento de saída | Converter o encontro interno no objeto do gabarito | nada além do tipo `Encounter` |

A serialização para texto (`JSON.stringify`, arquivo, CLI) fica na spec 004.

## 2. Estrutura de arquivos

```
src/encounters/
├── types.ts            # EncounterType, Encounter
├── haversine.ts        # EARTH_RADIUS_METERS, haversineDistance()
├── classify.ts         # classifyEncounter(a, b)
├── detect.ts           # ENCOUNTER_DISTANCE_METERS, detectEncounters(group)
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
    sinHalfDeltaLat * sinHalfDeltaLat +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * sinHalfDeltaLon * sinHalfDeltaLon;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
}
```

Detalhes que mudam o resultado no último bit e devem ser mantidos:

- A diferença é calculada **em graus** e só depois convertida (`toRadians(lat2 − lat1)`).
  Converter cada coordenada e subtrair erra em até 7,9·10⁻¹⁰ m.
- A conversão é `(x * Math.PI) / 180`. Usar `x * (Math.PI / 180)` ou `x / 180 * Math.PI`
  muda 1 a 3 dos 10 valores.
- O final é `2 * R * asin(√a)`. A forma `atan2(√a, √(1 − a))` muda 1 dos 10 valores.
- `x * x`, `x ** 2` e `Math.pow(x, 2)` deram o mesmo resultado nos 10 casos. O plano
  usa `x * x`, a forma mais direta.

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
  const protective = a.restrictedIds.includes(b.id) || b.restrictedIds.includes(a.id);
  const sameFaction = a.faction !== null && a.faction === b.faction;
  if (protective && sameFaction) {
    throw new EncounterClassificationError(a, b); // D1: tipo não definido pelo enunciado
  }
  if (protective) return "protetiva";
  if (sameFaction) return "faccao";
  return "generico";
}
```

- Os dois `if` independentes não definem uma precedência: o caso em que as duas
  condições são verdadeiras é tratado à parte (D1). Se a revisão escolher outra
  política para D1, só esta função muda.
- `includes` em arrays de 1 elemento (todos os dados observados) é mais barato que
  montar um `Set` por registro. A classificação só roda para pares abaixo de 20 m,
  que são raros (no máximo 21 em 1 milhão de registros nos datasets 1–5), então o
  custo é desprezível.
- `EncounterClassificationError` informa o timestamp e os dois ids.

## 6. Detecção de referência

```ts
export const ENCOUNTER_DISTANCE_METERS = 20;

export function detectEncounters(group: TimestampGroup): Encounter[] {
  const encounters: Encounter[] = [];
  const seenPairs = new Set<string>();       // R-08 / R-10
  const records = group.records;

  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const [first, second] = orderById(records[i], records[j]);
      if (first.id === second.id) continue;  // R-02
      const distance = haversineDistance(first.latitude, first.longitude, second.latitude, second.longitude);
      if (!(distance < ENCOUNTER_DISTANCE_METERS)) continue;   // R-04
      const key = `${first.id}:${second.id}`;
      if (seenPairs.has(key)) continue;      // primeira combinação vence (R-10)
      seenPairs.add(key);
      encounters.push({ type: classifyEncounter(first, second), timestamp: group.timestamp,
                        first, second, distanceMeters: distance });
    }
  }
  return encounters.sort(byIds);              // O-02
}
```

Decisões:

- **Todos os pares `i < j`.** Cada par de posições é avaliado uma vez, e o par
  `(i, j)` nunca é visitado como `(j, i)`. Por construção, não há duplicatas sem
  ids repetidos.
- **Deduplicação só sobre encontros.** O `Set` recebe uma chave apenas quando a
  distância está abaixo do limiar. Com ids únicos (todos os dados oficiais), ele tem
  no máximo poucos elementos por grupo e nunca descarta nada; ele existe para
  garantir R-08 quando a spec 001 entrega ids repetidos. A alternativa de verificar
  ids únicos antes da enumeração exigiria montar um `Set` com todos os ids de cada
  grupo, um custo `O(n)` por grupo mesmo quando não há encontro.
- **Primeira combinação vence (R-10).** Com ids repetidos, as combinações são
  visitadas na ordem do input, e a primeira abaixo do limiar é a registrada.
- **Ordenação O-02.** Ordenar os encontros de um grupo (poucos) por
  `(first.id, second.id)` é barato e torna a saída independente da ordem de
  enumeração. A spec 003 pode visitar os pares em outra ordem sem mudar a saída.
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
- Erros de entrada (`DatasetError`) e o erro de D1 se propagam ao consumidor pelo
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
| Unitário | `classifyEncounter` (CA-08): mesma facção; facções diferentes; facção × sem facção; restrição listada por `a`, por `b`, pelos dois; pessoa com restrição × terceiro; sobreposição (D1) | Registros sintéticos |
| Unitário | `detectEncounters`: R-02 e R-10 com ids repetidos (CA-06); ordem O-02; grupo de 0, 1 e 2 registros; independência da ordem do input | Grupos sintéticos |
| Unitário | `toOutputEncounter` (CA-09): ordem das chaves (`Object.keys`), ids crescentes, valores sem alteração | Sintético |
| Integração | `detectDatasetEncounters` sobre `groupByTimestamp`: registros próximos em timestamps diferentes (CA-05); par próximo em 3 timestamps consecutivos (CA-07); contrapressão (CA-10) | Linhas sintéticas |
| Aceitação | Datasets oficiais 1 e 2: `readDataset → detectDatasetEncounters → toOutputEncounter` comparado com `deepStrictEqual` aos gabaritos, incluindo ordem e distâncias exatas (CA-01, CA-02) | `test/fixtures/official/` |
| Manual | Datasets 3–5: quantidades 10, 15 e 21 e o par 28–31 em três timestamps (CA-07, CA-11); tempo e memória diagnósticos | `data/` local |

**Independência da referência nos testes de aceitação:** o gabarito oficial é a
referência dos datasets 1 e 2. Para os datasets 3–5 (sem gabarito), a referência é a
força bruta da análise exploratória, escrita separadamente e fora do código de
produção.

**Medição:** o script de medição da spec 001 será estendido (ou complementado) para
contar encontros e distâncias calculadas e medir tempo e memória com os datasets 1–5.
Números só serão registrados depois de executados.

## 11. Riscos

- **Desempenho nos datasets 6 e 7:** 396 e 714 milhões de distâncias. É a motivação
  da spec 003; esta referência não tem meta de tempo.
- **D1 pendente:** se a revisão preferir outra política, mudam apenas
  `classifyEncounter` e seus testes.
- **Dependência da fórmula exata:** a igualdade com os gabaritos depende da variante
  da seção 4. Qualquer refatoração da função precisa manter os testes de CA-03.

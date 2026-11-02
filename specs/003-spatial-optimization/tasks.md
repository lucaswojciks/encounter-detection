# Tarefas 003 — Otimização espacial

- **Status:** Em execução.
- **Spec:** [`spec.md`](spec.md) · **Plano:** [`plan.md`](plan.md)

Cada tarefa termina com `npm run typecheck` e `npm test` sem falhas.

---

## T01 — Dimensões da grade

- [ ] Concluída

- **Objetivo:** calcular `h`, `w(Φ)`, `C` e `W` (plano, seção 2).
- **Arquivos:** `src/encounters/spatial-hash.ts`, `test/encounters/spatial-hash.test.ts`.
- **Critérios de conclusão:** funções puras exportadas para teste; margem de 0,1 %;
  coluna única quando `C < 3` ou sem limite.
- **Testes:** `h` = `(20,02 / R) · 180/π`; `w(0)` = `h`; `w` cresce com `Φ`;
  `W ≥ w` e `360 / W` inteiro; coluna única em `Φ = 90°`.
- **Dependências:** nenhuma.

## T02 — Estratégia `spatialHash`

- [ ] Concluída

- **Objetivo:** implementar a indexação por grupo e a visita das 9 células
  (plano, seção 5).
- **Arquivos:** `src/encounters/spatial-hash.ts`.
- **Critérios de conclusão:** implementa `PairSearch`; pares visitados uma vez, com
  `j > i`, em ordem crescente de `(i, j)`; antimeridiano e coluna única tratados.
- **Dependências:** T01.

## T03 — Testes com casos construídos

- [ ] Concluída

- **Objetivo:** CA-03 com posições escolhidas.
- **Arquivos:** `test/encounters/spatial-hash.test.ts`.
- **Testes:** mesma célula; vizinhas por linha, por coluna e na diagonal; pontos
  exatamente sobre as bordas; coordenadas positivas e negativas; equador, latitudes
  médias e altas e polo; antimeridiano (−180/180); grupo denso; distância abaixo,
  **exatamente igual** e acima de 20 m. Em todos: encontros iguais aos de `allPairs`.
- **Dependências:** T02.

## T04 — Testes de propriedade

- [ ] Concluída

- **Objetivo:** CA-04 em grupos aleatórios reprodutíveis.
- **Arquivos:** `test/encounters/spatial-hash.test.ts`.
- **Critérios de conclusão:** gerador com semente fixa; aglomerados em várias
  latitudes e longitudes, com distâncias perto de 20 m; verificação de: encontros
  iguais; todo par com `d < 20` visitado; nenhuma visita repetida; ordem igual à de
  `allPairs` restrita aos candidatos.
- **Dependências:** T02.

## T05 — Aceitação com os datasets oficiais

- [ ] Concluída

- **Objetivo:** CA-01 e CA-02 (datasets 1 e 2) com `spatialHash`.
- **Arquivos:** `test/encounters/official-encounters.test.ts`.
- **Critérios de conclusão:** as duas estratégias reproduzem os gabaritos e são
  iguais entre si.
- **Dependências:** T02.

## T06 — Comparação nos datasets 3 a 5

- [ ] Concluída

- **Objetivo:** CA-02 para os datasets sem gabarito.
- **Arquivos:** `scripts/compare-strategies.ts`.
- **Critérios de conclusão:** para cada grupo, `isDeepStrictEqual` entre as listas
  de encontros das duas estratégias; relatório com contagens e divergências (esperado:
  nenhuma).
- **Dependências:** T02.

## T07 — Instrumentação do benchmark

- [ ] Concluída

- **Objetivo:** permitir medir as duas estratégias nas mesmas condições (plano,
  seção 9).
- **Arquivos:** `scripts/measure-encounters.ts`.
- **Critérios de conclusão:** opção `--search all|spatial`; opção `--count` com
  contagem de pares candidatos e de cálculos de Haversine, numa execução separada da
  medição de tempo.
- **Dependências:** T02.

## T08 — Benchmarks

- [ ] Concluída

- **Objetivo:** CA-05 e CA-06.
- **Arquivos:** `plan.md` (resultados).
- **Critérios de conclusão:** 5 execuções alternadas por estratégia nos datasets 3, 4
  e 5 (e execuções de referência nos datasets 1 e 2); leitura, detecção, total,
  candidatos, Haversine e memória; mediana, mínimo e máximo; conclusão sobre a adoção.
- **Dependências:** T06, T07.

## T09 — Documentação

- [ ] Concluída

- **Objetivo:** atualizar spec, plano, tarefas e `specs/README.md` com os resultados.
- **Dependências:** T01–T08.

---

## Dependências

| Tarefa | Depende de |
| ------ | ---------- |
| T01 | — |
| T02 | T01 |
| T03, T04, T05, T06, T07 | T02 |
| T08 | T06, T07 |
| T09 | T01–T08 |

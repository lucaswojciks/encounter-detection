# Tarefas 002 — Detecção de encontros

- **Status:** Todas as tarefas concluídas em 2026-11-02; integrada à `main`.
- **Spec:** [`spec.md`](spec.md) · **Plano:** [`plan.md`](plan.md)

Decisões D1 e D3 aprovadas (spec, seção 9).

Cada tarefa termina com `npm run typecheck` e `npm test` sem falhas.

---

## T01 — Tipos do domínio de encontros

- [x] Concluída

- **Objetivo:** definir `EncounterType` e `Encounter` (plano, seção 3).
- **Arquivos:** `src/encounters/types.ts`.
- **Critérios de conclusão:** tipos `readonly`; `Encounter` referencia os dois
  `LocationRecord` (`first` com o menor id).
- **Testes:** cobertos pelo typecheck e pelas tarefas seguintes.
- **Dependências:** spec 001 (tipos `LocationRecord` e `TimestampGroup`).

## T02 — Haversine

- [x] Concluída

- **Objetivo:** implementar `haversineDistance` e `EARTH_RADIUS_METERS` exatamente
  como no plano, seção 4.
- **Arquivos:** `src/encounters/haversine.ts`, `test/encounters/haversine.test.ts`.
- **Critérios de conclusão:** as 10 distâncias oficiais reproduzidas com `===`.
- **Testes (CA-03):**
  - As 10 posições e distâncias lidas de `test/fixtures/official/respostas*.json`,
    nos dois sentidos de argumento.
  - Mesmo ponto → `0`.
  - Par 31–43 do dataset 4 → `10.584413373886989`, fixando o sin² como termo único
    (plano, seção 4; decisão técnica, não gabarito).
  - 1° de latitude no mesmo meridiano → `6371000 * Math.PI / 180`, com tolerância de
    10⁻⁶ m (valor analítico, não gabarito).
- **Dependências:** nenhuma.

## T03 — Classificação

- [x] Concluída

- **Objetivo:** implementar `classifyEncounter` (R-05 a R-07).
- **Arquivos:** `src/encounters/classify.ts`, `test/encounters/classify.test.ts`.
- **Critérios de conclusão:** as regras do plano (seção 5).
- **Testes (CA-08):**
  - `faccao`: mesma facção.
  - `generico`: ambos sem facção; facções diferentes; facção × sem facção; pessoa com
    restrição × pessoa fora da lista.
  - `protetiva`: `a` lista `b`; `b` lista `a`; ambos se listam; lista com vários ids
    contendo o outro.
  - `medidaProtetiva = true` com lista que não contém o outro → `generico`.
- **Dependências:** T01.

## T04 — Detecção em um grupo

- [x] Concluída

- **Objetivo:** implementar a estratégia de referência `allPairs` (`PairSearch`), além de
  `detectEncounters` e `ENCOUNTER_DISTANCE_METERS` (plano, seção 6).
- **Arquivos:** `src/encounters/pair-search.ts`, `src/encounters/detect.ts`,
  `test/encounters/pair-search.test.ts`, `test/encounters/detect.test.ts`.
- **Critérios de conclusão:** todos os pares `i < j`; limiar estrito; ids ordenados;
  deduplicação por par; ordenação O-02.
- **Testes:**
  - Limiar (CA-04): o teste busca, por bisseção na latitude, dois pontos com
    distância calculada logo abaixo de 20 m e logo acima (ou igual) e verifica que só
    o primeiro gera encontro; `ENCOUNTER_DISTANCE_METERS === 20`.
  - Grupos com 0, 1 e 2 registros; três registros próximos → três encontros.
  - Ids repetidos no grupo (CA-06): o par é registrado uma vez, com a primeira
    combinação na ordem do input; o mesmo id nunca encontra a si mesmo.
  - Ordem O-02 e independência da ordem do input: o mesmo grupo embaralhado produz os
    mesmos encontros.
  - `first.id < second.id` mesmo quando o input traz o maior id primeiro.
  - `allPairs` visita exatamente `n(n − 1)/2` pares `i < j`, na ordem do input.
  - Uma estratégia que entrega o mesmo candidato duas vezes não gera duplicatas, e o
    resultado não depende da estratégia (mesmos encontros com `allPairs` e com uma
    estratégia que entrega os pares invertidos e embaralhados).
- **Dependências:** T02, T03.

## T05 — Detecção sobre o fluxo de grupos

- [x] Concluída

- **Objetivo:** implementar `detectDatasetEncounters` (plano, seção 7).
- **Arquivos:** `src/encounters/detect-stream.ts`,
  `test/encounters/detect-stream.test.ts`.
- **Critérios de conclusão:** um grupo por vez, sem estado entre grupos; erros
  propagados ao consumidor.
- **Testes (sobre `groupByTimestamp` com linhas sintéticas):**
  - Registros próximos em timestamps diferentes não geram encontro (CA-05).
  - Par próximo em três timestamps consecutivos → três encontros, um por timestamp
    (CA-07).
  - Os encontros do primeiro grupo são entregues antes de o segundo grupo ser lido
    (CA-10).
  - `DatasetError` da spec 001 chega ao consumidor.
- **Dependências:** T04.

## T06 — Mapeamento para o formato de saída

- [x] Concluída

- **Objetivo:** implementar `OutputEncounter` e `toOutputEncounter` (plano, seção 8).
- **Arquivos:** `src/encounters/output.ts`, `test/encounters/output.test.ts`.
- **Critérios de conclusão:** chaves na ordem do gabarito; ids crescentes; valores
  copiados sem formatação.
- **Testes (CA-09):** `Object.keys` do objeto e de `posicoes`; valores idênticos aos
  do registro; `JSON.stringify` de um encontro do gabarito reconstruído é igual ao
  trecho correspondente do gabarito.
- **Dependências:** T01.

## T07 — Aceitação com os datasets oficiais

- [x] Concluída

- **Objetivo:** CA-01 e CA-02.
- **Arquivos:** `test/encounters/official-encounters.test.ts`.
- **Critérios de conclusão:** para os datasets 1 e 2,
  `readDataset → detectDatasetEncounters → toOutputEncounter` é `deepStrictEqual` ao
  gabarito: mesma quantidade, ordem, tipos, ids, timestamps, posições e distâncias
  exatas.
- **Testes:** os próprios critérios. Em caso de falha, a mensagem deve mostrar o
  encontro divergente.
- **Dependências:** T05, T06.

## T08 — Verificação com os datasets 3 a 5

- [x] Concluída

- **Objetivo:** CA-07 e CA-11 com dados reais sem gabarito.
- **Arquivos:** `scripts/measure-encounters.ts` (`--list`) e registro dos resultados no
  `plan.md`.
- **Critérios de conclusão:** 10, 15 e 21 encontros nos datasets 3, 4 e 5; par 28–31
  do dataset 3 em 01:00:30, 01:00:35 e 01:00:40. Resultados registrados com data,
  versão do Node e comando.
- **Testes:** não automatizados (arquivos não versionados).
- **Dependências:** T05.

## T09 — Medição diagnóstica

- [x] Concluída

- **Objetivo:** registrar tempo, memória, distâncias calculadas e encontros dos
  datasets 1 a 5, como referência para a spec 003.
- **Arquivos:** `scripts/measure-encounters.ts`, `plan.md` (seção 12).
- **Critérios de conclusão:** números apenas de execuções reais, com ambiente e
  comando; nenhuma meta de desempenho definida.
- **Dependências:** T05.

## T10 — Revisão da documentação

- [x] Concluída

- **Objetivo:** alinhar spec, plano, tarefas e `specs/README.md` com a implementação.
- **Arquivos:** `specs/002-encounter-detection/*.md`, `specs/README.md`.
- **Dependências:** T01–T09.

---

## Ordem e dependências

| Tarefa | Depende de |
| ------ | ---------- |
| T01 | spec 001 |
| T02 | — |
| T03 | T01 |
| T04 | T02, T03 |
| T05 | T04 |
| T06 | T01 |
| T07 | T05, T06 |
| T08 | T05 |
| T09 | T05 |
| T10 | T01–T09 |

Ordem sugerida: T01 → T02 → T03 → T04 → T05 → T06 → T07 → T08 → T09 → T10.

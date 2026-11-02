# Tarefas 004 — Saída e validação

- **Status:** Todas as tarefas concluídas em 2026-11-02; integrada à `main`.
- **Spec:** [`spec.md`](spec.md) · **Plano:** [`plan.md`](plan.md)

Cada tarefa termina com `npm run typecheck` e `npm test` sem falhas.

---

## T01 — Escritor incremental e atômico

- [x] Concluída

- **Objetivo:** `writeJsonArray` (plano, seção 2).
- **Arquivos:** `src/output/json-writer.ts`, `test/output/json-writer.test.ts`.
- **Critérios de conclusão:** texto idêntico a `JSON.stringify(lista, null, 2)`;
  buffer com descarga por tamanho; temporário no diretório do destino; `rename` só no
  sucesso; limpeza em erro.
- **Testes:** CA-03 (0, 1 e vários itens; gabaritos oficiais); CA-04 (temporário
  cresce e destino ausente durante a escrita); falha do iterável no meio; destino
  preexistente intacto após falha; destino que é um diretório (CA-07).
- **Dependências:** nenhuma.

## T02 — Processamento de um dataset

- [x] Concluída

- **Objetivo:** `processDataset` (plano, seção 1), com estatísticas e `AbortSignal`.
- **Arquivos:** `src/process-dataset.ts`, `test/process-dataset.test.ts`.
- **Critérios de conclusão:** usa `readDataset`, `detectDatasetEncounters`,
  `toOutputEncounter` e `writeJsonArray` sem duplicar regras; padrão `spatialHash`;
  devolve registros, timestamps, encontros por tipo e duração.
- **Testes:** estatísticas do dataset 1; estratégia padrão e `allPairs` com o mesmo
  arquivo; dataset só com cabeçalho → `[]` (CA-05); interrupção pelo sinal sem
  arquivo final; erro de entrada sem arquivo final.
- **Dependências:** T01.

## T03 — Argumentos da CLI

- [x] Concluída

- **Objetivo:** `parseArguments` com `util.parseArgs` (plano, seção 3).
- **Arquivos:** `src/cli/arguments.ts`, `test/cli/arguments.test.ts`.
- **Critérios de conclusão:** dataset obrigatório; `--output`/`-o`; `--search
  spatial|all` (padrão `spatial`); `--help`/`-h`; erros de uso com mensagem.
- **Testes:** CA-01.
- **Dependências:** nenhuma.

## T04 — CLI

- [x] Concluída

- **Objetivo:** `src/cli.ts` com resumo, mensagens de erro, códigos de saída e
  `SIGINT`.
- **Arquivos:** `src/cli.ts`, `test/cli.test.ts`, `.gitignore` (`outputs/`).
- **Critérios de conclusão:** CLI-01 a CLI-06.
- **Testes:** códigos 0, 1 e 2; mensagens; nome padrão do output; gabaritos byte a
  byte com `spatial` e `all` (CA-02, CA-08); dataset inválido e inexistente sem output
  (CA-06); destino inválido (CA-07).
- **Dependências:** T02, T03.

## T05 — Validador de outputs

- [x] Concluída

- **Objetivo:** VAL-02 (plano, seção 4).
- **Arquivos:** `src/output/validate-output.ts`, `scripts/validate-output.ts`,
  `test/output/validate-output.test.ts`.
- **Critérios de conclusão:** todas as verificações do plano; sem uso de estratégia
  de busca.
- **Testes:** CA-09: gabaritos aceitos (com e sem dataset); uma rejeição para cada
  regra (campo ausente, ordem de chaves, tipo inválido, ids fora de ordem, distância
  ≥ 20, distância divergente, par repetido, ordem, posição diferente da do dataset,
  tipo diferente da classificação).
- **Dependências:** nenhuma.

## T06 — Amostragem na comparação de estratégias

- [x] Concluída

- **Objetivo:** opção `--every <k>` em `scripts/compare-strategies.ts` (VAL-03).
- **Dependências:** nenhuma.

## T07 — Datasets 6 e 7

- [x] Concluída

- **Objetivo:** download em streaming com verificação de tamanho (plano, seção 6).
- **Critérios de conclusão:** tamanho igual ao `Content-Length`; arquivos em `data/`.

## T08 — Geração e validação dos sete outputs

- [x] Concluída

- **Objetivo:** CA-10 e CA-11.
- **Critérios de conclusão:** CLI com `spatialHash` nos datasets 1 a 7; validador com
  `--dataset` em todos; gabaritos 1 e 2 byte a byte; comparação de estratégias nos
  datasets 6 e 7 (amostra e completa); resultados, tempo, memória e tamanhos
  registrados no plano; decisão sobre versionar `outputs/`.
- **Dependências:** T04, T05, T06, T07.

## T09 — Documentação

- [x] Concluída

- **Objetivo:** atualizar spec, plano, tarefas e `specs/README.md`.
- **Dependências:** T01–T08.

---

## Dependências

| Tarefa | Depende de |
| ------ | ---------- |
| T01, T03, T05, T06, T07 | — |
| T02 | T01 |
| T04 | T02, T03 |
| T08 | T04, T05, T06, T07 |
| T09 | T01–T08 |

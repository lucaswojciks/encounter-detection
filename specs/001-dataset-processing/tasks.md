# Tarefas 001 — Processamento de datasets

- **Status:** Todas as tarefas concluídas em 2026-11-02; integrada à `main`.
- **Spec:** [`spec.md`](spec.md) · **Plano:** [`plan.md`](plan.md)

Cada tarefa termina com `npm run typecheck` e `npm test` sem falhas.

---

## T01 — Tipos e erro do domínio

- [x] Concluída

- **Objetivo:** definir `LocationRecord`, `TimestampGroup` e `DatasetError`.
- **Arquivos:** `src/dataset/types.ts`, `src/dataset/dataset-error.ts`,
  `test/dataset/dataset-error.test.ts`.
- **Critérios de conclusão:** tipos conforme o plano (seção 3), com propriedades
  `readonly`; `DatasetError` expõe `source`, `lineNumber` e `field` opcionais e os
  inclui na mensagem.
- **Testes:** mensagem com todas as partes, com partes ausentes; `instanceof Error`.
- **Dependências:** nenhuma.

## T02 — Conversão dos campos

- [x] Concluída

- **Objetivo:** validação e conversão de cada campo conforme a seção 4.2 da spec.
- **Arquivos:** `src/dataset/parse-record.ts`, `test/dataset/parse-record.test.ts`.
- **Critérios de conclusão:** todos os formatos aceitos são convertidos sem alteração
  de valor; todos os formatos rejeitados geram `DatasetError` com o campo.
- **Testes (CA-07):**
  - id/facção: `1`, `120` aceitos; facção vazia → `null`; `-1`, `1.0`, `1e3`, `0x10`,
    ` 1`, vazio (id), `9007199254740992` rejeitados.
  - coordenadas: `-25.59386`, `90`, `-90.00000`, `180.00000`, `-180` aceitos;
    `90.00001`, `-180.00001`, `1e1`, `.5`, `0x1`, vazio rejeitados.
  - booleano: `true`, `false` aceitos; `TRUE`, `1`, vazio rejeitados.
  - timestamp: `"2024-01-01 00:00:00"` e `2024-01-01 00:00:00` → `2024-01-01 00:00:00`;
    vazio, `""`, `"2024-01-01T00:00:00"`, `"2024-01-01 00:00"`, aspas desbalanceadas
    rejeitados.
  - restrições: vazio → `[]`; `"10"` e `10` → `[10]`; `"10,11"` → `[10, 11]`; `"10,"`,
    `",10"`, `"10, 11"`, `"a"`, `"10` rejeitados.
- **Dependências:** T01.

## T03 — `parseRecord`

- [x] Concluída

- **Objetivo:** converter uma linha completa em `LocationRecord`.
- **Arquivos:** `src/dataset/parse-record.ts`, `test/dataset/parse-record.test.ts`.
- **Critérios de conclusão:** E-04 (número de campos ≠ 7) e E-05 (delegado a T02), com
  arquivo, linha e campo no erro.
- **Testes:** linhas reais do dataset 1 (ids 7 e 9 do primeiro timestamp); linhas com 6
  e 8 campos.
- **Dependências:** T02.

## T04 — `groupByTimestamp`

- [x] Concluída

- **Objetivo:** gerador assíncrono que valida o cabeçalho, ignora linhas vazias, agrupa
  registros consecutivos com timestamp idêntico e aplica E-06.
- **Arquivos:** `src/dataset/group-by-timestamp.ts`,
  `test/dataset/group-by-timestamp.test.ts`.
- **Critérios de conclusão:** aceita `Iterable<string> | AsyncIterable<string>`;
  remove BOM e `\r` final; emite grupos em ordem, inclusive o último; numeração de
  linhas com cabeçalho = 1.
- **Testes:**
  - Agrupamento básico; grupos de tamanhos diferentes; grupo de 1 registro.
  - Só cabeçalho → 0 grupos (CA-08); entrada vazia → E-02; cabeçalho errado → E-03.
  - Linhas vazias ignoradas sem alterar a numeração; CRLF e BOM (CA-05).
  - Timestamp que retrocede e timestamp que reaparece → E-06, sem grupos após o erro.
- **Dependências:** T03.

## T05 — Contrapressão

- [x] Concluída

- **Objetivo:** demonstrar RF-04/RF-05 (CA-09).
- **Arquivos:** `test/dataset/group-by-timestamp.test.ts`.
- **Critérios de conclusão:** com uma fonte instrumentada, ao receber o primeiro grupo
  o gerador consumiu apenas as linhas do primeiro grupo e a primeira do segundo; um
  `break` do consumidor encerra a fonte.
- **Dependências:** T04.

## T06 — `readDataset`

- [x] Concluída

- **Objetivo:** adaptador de arquivo (plano, seção 4).
- **Arquivos:** `src/dataset/read-dataset.ts`, `test/dataset/read-dataset.test.ts`.
- **Critérios de conclusão:** `createReadStream` + `readline`; erros de I/O viram
  `DatasetError` com o caminho (E-01); stream fechado no fim, em erro e em `break`.
- **Testes:** arquivos temporários com o mesmo conteúdo em LF, CRLF, com BOM e sem `\n`
  final produzem grupos iguais (CA-05); erro reporta caminho e linha; arquivo
  inexistente; arquivo vazio. O teste de remoção do arquivo após `break` foi
  descartado por não detectar a falha no Windows (ver plano, seção 11).
- **Dependências:** T04.

## T07 — Fixtures oficiais

- [x] Concluída

- **Objetivo:** versionar datasets 1 e 2 e gabaritos sem modificação.
- **Arquivos:** `test/fixtures/official/*`, `.gitattributes`.
- **Critérios de conclusão:** arquivos idênticos aos originais (hash conferido);
  marcados como `-text`.
- **Dependências:** nenhuma.

## T08 — Testes de aceitação com datasets oficiais

- [x] Concluída

- **Objetivo:** CA-01 a CA-04.
- **Arquivos:** `test/dataset/official-datasets.test.ts`.
- **Critérios de conclusão:**
  - Contagens: dataset 1 com 500 grupos × 10; dataset 2 com 1 250 × 20.
  - Todos os campos de todos os registros iguais à leitura independente do arquivo.
  - Posições dos gabaritos iguais às coordenadas dos registros correspondentes.
  - Facções e restrições conferem com a análise (dataset 1: 2 membros da facção 1;
    id 9 com restrição `[10]`).
- **Dependências:** T06, T07.

## T09 — Medição diagnóstica

- [x] Concluída

- **Objetivo:** CA-10.
- **Arquivos:** `scripts/measure-dataset.ts`, `package.json` (script `measure`),
  `tsconfig.json` (inclusão de `scripts/`), seção de resultados no `plan.md`.
- **Critérios de conclusão:** para os datasets 1 a 5, registrar tempo, registros,
  grupos, maior grupo, pico de heap e RSS máximo, com versão do Node, sistema e
  comando. Nenhum número sem execução real.
- **Dependências:** T06.

## T10 — Revisão da documentação

- [x] Concluída

- **Objetivo:** alinhar spec, plano, tarefas e índice com a implementação.
- **Arquivos:** `specs/001-dataset-processing/*.md`, `specs/README.md`.
- **Dependências:** T01–T09.

---

## Ordem e dependências

```
T01 ─► T02 ─► T03 ─► T04 ─┬─► T05
                          └─► T06 ─┬─► T08 ◄── T07
                                   └─► T09
T01–T09 ─► T10
```

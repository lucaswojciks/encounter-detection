# Tarefas 001 — Processamento de datasets

- **Status:** Em revisão. Nenhuma tarefa iniciada.
- **Spec:** [`spec.md`](spec.md) · **Plano:** [`plan.md`](plan.md)

Pré-requisito para iniciar: aprovação das decisões D1–D7 da spec (seção 10) e da
decisão sobre fixtures oficiais (plano, seção 10). Se alguma for alterada, as tarefas
afetadas devem ser revistas antes da implementação.

Cada tarefa termina com `npm run typecheck` e `npm test` sem falhas.

---

## T01 — Tipos e erro do domínio

- [ ] Concluída

- **Objetivo:** definir `LocationRecord`, `TimestampGroup`, `DatasetStats` e
  `DatasetError`.
- **Arquivos:** `src/dataset/types.ts`, `src/dataset/errors.ts`,
  `test/dataset/errors.test.ts`.
- **Critérios de conclusão:**
  - Tipos conforme o plano, seção 3, com propriedades `readonly`.
  - `DatasetError` expõe `lineNumber` e `field` opcionais, e a mensagem inclui ambos
    quando presentes.
- **Testes:** construção de `DatasetError` com e sem linha/campo; `instanceof Error`.
- **Dependências:** nenhuma.

## T02 — Validação de campos escalares

- [ ] Concluída

- **Objetivo:** funções puras de validação e conversão para id/facção, coordenadas,
  booleano e timestamp (incluindo validade de calendário).
- **Arquivos:** `src/dataset/parse-record.ts` (funções internas exportadas para
  teste), `test/dataset/parse-record.test.ts`.
- **Critérios de conclusão:** cada regra da seção 3.2 da spec implementada para esses
  campos.
- **Testes (CA-07):**
  - id: `1`, `120`, `9007199254740991` (válidos); `0`, `01`, `-1`, `1.0`, `1e3`,
    `0x10`, ` 1`, `""`, `9007199254740992` (inválidos).
  - coordenadas: `90.00000`, `-90.00000`, `-180.00000`, `0.00000` (válidos);
    `90.00001`, `180.00001`, `-25`, `+1.0`, `1e1`, `.5`, `""` (inválidos).
  - booleano: `true`, `false` (válidos); `TRUE`, `1`, `""` (inválidos).
  - timestamp: `"2024-01-01 00:00:00"`, `"2024-02-29 23:59:59"` (válidos);
    `"2023-02-29 00:00:00"`, `"2024-02-30 00:00:00"`, `"2024-13-01 00:00:00"`,
    `"2024-01-01 24:00:00"`, `"2024-01-01 00:60:00"`, sem aspas, com `T`, com `Z`
    (inválidos).
- **Dependências:** T01.

## T03 — Lista de restrições

- [ ] Concluída

- **Objetivo:** validar e converter `idsRestricaoMedida`.
- **Arquivos:** `src/dataset/parse-record.ts`, `test/dataset/parse-record.test.ts`.
- **Critérios de conclusão:** vazio → `[]`; lista entre aspas → array de inteiros na
  ordem original.
- **Testes:** `""` → `[]`; `"10"` → `[10]`; `"10,11"` → `[10, 11]`; inválidos: `10`
  (sem aspas), `"10,"`, `",10"`, `"10, 11"`, `"10`, `""""`, `"a"`, `"0"`.
- **Dependências:** T01.

## T04 — `parseRecord`

- [ ] Concluída

- **Objetivo:** converter uma linha completa em `LocationRecord`, aplicando também as
  regras entre campos.
- **Arquivos:** `src/dataset/parse-record.ts`, `test/dataset/parse-record.test.ts`.
- **Critérios de conclusão:**
  - RI-03: número de campos ≠ 7.
  - RI-04: delega para T02/T03, com o nome do campo no erro.
  - RI-08: `medidaProtetiva` incoerente com a lista.
  - RI-09: lista contendo o próprio id.
  - Linha e campo informados em todo erro.
- **Testes:**
  - Linhas reais do dataset 1 (ids 7 e 9 do primeiro timestamp) resultam nos
    objetos esperados (CA-03, CA-04, nível unitário).
  - Linhas com 6 e 8 campos e com `;` final extra.
  - Um teste para cada um de RI-08 (nos dois sentidos) e RI-09.
- **Dependências:** T02, T03.

## T05 — `groupByTimestamp`

- [ ] Concluída

- **Objetivo:** gerador assíncrono que valida o cabeçalho, ignora linhas vazias,
  agrupa registros contíguos e aplica RI-05/06/07.
- **Arquivos:** `src/dataset/group-by-timestamp.ts`,
  `test/dataset/group-by-timestamp.test.ts`.
- **Critérios de conclusão:**
  - Aceita `Iterable<string> | AsyncIterable<string>`.
  - Remove BOM e `\r` final antes de comparar o cabeçalho e ao processar cada linha.
  - Emite grupos em ordem, inclusive o último.
  - Erros com número de linha (cabeçalho = linha 1).
  - Contadores de registros e grupos disponíveis ao fim (RF-06).
- **Testes:**
  - Agrupamento básico (3 timestamps × 2 registros); grupos de tamanhos diferentes;
    grupo de 1 registro.
  - Arquivo só com cabeçalho → 0 grupos (CA-08); entrada vazia → RI-01; cabeçalho
    errado → RI-02.
  - Linhas vazias no meio e no fim são ignoradas sem alterar a numeração.
  - Timestamp que retrocede (RI-05); timestamp que reaparece (RI-06); id duplicado no
    grupo (RI-07). Em todos, nenhum grupo é emitido após o erro.
  - Os arrays emitidos não são modificados depois de entregues.
- **Dependências:** T04.

## T06 — Contrapressão do agrupador

- [ ] Concluída

- **Objetivo:** demonstrar que a leitura acompanha o ritmo do consumidor (RF-04,
  RF-05, CA-09).
- **Arquivos:** `test/dataset/group-by-timestamp.test.ts`.
- **Critérios de conclusão:** com uma fonte de linhas instrumentada, ao receber o
  primeiro grupo o gerador consumiu no máximo as linhas do primeiro grupo e a primeira
  linha do segundo.
- **Testes:** o próprio teste descrito; também a interrupção do consumo (`break`)
  finaliza a fonte (`return` chamado).
- **Dependências:** T05.

## T07 — `readDataset` (adaptador de arquivo)

- [ ] Concluída

- **Objetivo:** abrir o arquivo em stream e entregar as linhas ao agrupador.
- **Arquivos:** `src/dataset/read-dataset.ts`, `test/dataset/read-dataset.test.ts`,
  `test/dataset/fixtures/*.txt`.
- **Critérios de conclusão:**
  - Usa `createReadStream` + `readline` (plano, seção 4).
  - Arquivo inexistente gera `DatasetError` com o caminho.
  - O stream é fechado ao terminar, ao ocorrer erro e com `break` do consumidor.
- **Testes (CA-05):** fixtures pequenas com o mesmo conteúdo em LF, CRLF, com BOM e sem
  `\n` final produzem grupos idênticos; fixture com erro na linha N reporta N; arquivo
  inexistente.
- **Fixtures:** escritas à mão, com poucas linhas, sem dados reais além de trechos
  curtos.
- **Dependências:** T05.

## T08 — Testes de aceitação com datasets oficiais 1 e 2

- [ ] Concluída

- **Objetivo:** validar CA-01 a CA-04 com os arquivos oficiais.
- **Arquivos:** `test/fixtures/official/` (conforme decisão aprovada),
  `test/dataset/official-datasets.test.ts`.
- **Critérios de conclusão:**
  - `dataset1.txt`: 500 grupos × 10 registros; `dataset2.txt`: 1 250 × 20.
  - Primeiro e último timestamp conferem com a análise
    (`00:00:00`/`00:41:35` e `00:00:00`/`01:44:05`).
  - Atributos dos ids 7 e 9 do primeiro grupo do dataset 1 conferem com CA-03/CA-04.
- **Testes:** os próprios critérios.
- **Dependências:** T07; aprovação da decisão sobre fixtures.

## T09 — Verificação manual com datasets 3–5 e memória limitada

- [ ] Concluída

- **Objetivo:** executar CA-10 e CA-11 e registrar os resultados reais.
- **Arquivos:** script de verificação (local ou em `scripts/`, a definir na revisão) e
  uma seção de resultados em `specs/001-dataset-processing/` ou no README.
- **Critérios de conclusão:**
  - Contagens dos datasets 3–5 iguais às da análise.
  - `dataset5.txt` processado com `node --max-old-space-size=64` sem erro.
  - Resultados registrados com data, versão do Node e comando usado. Nenhum número
    é registrado sem execução real.
- **Testes:** não automatizados (arquivos grandes não versionados).
- **Dependências:** T07.

## T10 — Revisão da documentação

- [ ] Concluída

- **Objetivo:** alinhar spec, plano e status com o que foi implementado.
- **Arquivos:** `specs/001-dataset-processing/*.md`, `specs/README.md`.
- **Critérios de conclusão:** divergências entre plano e implementação documentadas;
  status da spec atualizado; tarefas marcadas apenas quando concluídas.
- **Dependências:** T01–T09.

---

## Ordem e dependências

```
T01 ─┬─► T02 ─┐
     └─► T03 ─┴─► T04 ─► T05 ─┬─► T06
                              └─► T07 ─┬─► T08
                                       └─► T09
T01–T09 ─► T10
```

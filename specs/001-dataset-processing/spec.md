# Spec 001 — Processamento de datasets

- **Status:** Em revisão
- **Documentos relacionados:** [`plan.md`](plan.md), [`tasks.md`](tasks.md),
  [`dataset-analysis.md`](dataset-analysis.md)

## 1. Objetivo

Ler um arquivo de registros de localização de indivíduos monitorados, validar cada
registro e entregá-los **agrupados por timestamp**, em ordem de leitura, para a
etapa de detecção de encontros (spec 002).

O processamento deve funcionar com arquivos de centenas de megabytes (≈12 milhões de
registros) com uso de memória limitado, sem carregar o arquivo inteiro, e produzir
sempre o mesmo resultado para a mesma entrada.

## 2. Fora de escopo

- Cálculo de distância, detecção e classificação de encontros (spec 002).
- Indexação espacial e otimizações (spec 003).
- Geração e validação do arquivo de saída (spec 004).
- Interface de linha de comando, além do necessário para integração futura.

## 3. Formato de entrada

### 3.1 Arquivo

- Texto UTF-8. Um BOM UTF-8 no início, se presente, é ignorado.
- Quebras de linha `LF` ou `CRLF`.
- A última linha pode ou não terminar com quebra de linha.
- A primeira linha é o cabeçalho, que deve ser exatamente:

  ```
  idMonitorado;faccaoMonitorado;timestamp;latitude;longitude;medidaProtetiva;idsRestricaoMedida
  ```

- Cada linha seguinte é um registro com **7 campos** separados por `;`.
- Linhas vazias (sem nenhum caractere) são ignoradas.

### 3.2 Campos

| # | Campo                | Regra de validação | Valor resultante |
| - | -------------------- | ------------------ | ---------------- |
| 1 | `idMonitorado`       | Inteiro decimal positivo, sem sinal, sem zeros à esquerda, dentro do intervalo de inteiros seguros. | Inteiro |
| 2 | `faccaoMonitorado`   | Vazio, ou inteiro com a mesma regra do campo 1. | Inteiro, ou "sem facção" |
| 3 | `timestamp`          | Entre aspas duplas, no formato `YYYY-MM-DD HH:MM:SS`, representando data e hora válidas no calendário. | Texto sem as aspas |
| 4 | `latitude`           | Número decimal com sinal `-` opcional, parte inteira e parte fracionária (`-?D+.D+`), no intervalo [−90, 90]. | Número de ponto flutuante |
| 5 | `longitude`          | Mesmo formato do campo 4, no intervalo [−180, 180]. | Número de ponto flutuante |
| 6 | `medidaProtetiva`    | `true` ou `false`. | Booleano |
| 7 | `idsRestricaoMedida` | Vazio, ou lista entre aspas duplas de um ou mais inteiros (regra do campo 1) separados por `,`, sem espaços. | Lista de inteiros (vazia se o campo for vazio) |

Notas:

- Espaços ao redor dos valores não são aceitos (nenhum foi observado; aceitá-los
  esconderia arquivos malformados).
- O timestamp **não tem fuso horário** e é tratado como texto: dois registros têm o
  mesmo timestamp se e somente se os textos forem idênticos.
- As coordenadas são convertidas para número sem arredondamento adicional. O texto
  original não precisa ser preservado: o gabarito usa o valor numérico
  (`-44.63520` → `-44.6352`).

## 4. Requisitos funcionais

- **RF-01** O processamento recebe o caminho de um arquivo e produz uma sequência de
  **grupos**, cada um com um timestamp e os registros daquele timestamp.
- **RF-02** Os grupos são produzidos na ordem em que aparecem no arquivo, e os
  registros de cada grupo mantêm a ordem do arquivo.
- **RF-03** Cada registro expõe: id, facção (ou ausência), timestamp, latitude,
  longitude, indicador de medida protetiva e lista de ids de restrição.
- **RF-04** O processamento é **incremental**: cada grupo fica disponível para o
  consumidor assim que é concluído, sem aguardar o fim do arquivo.
- **RF-05** O consumidor controla o ritmo: o leitor não avança indefinidamente se o
  consumidor ainda não processou os grupos anteriores.
- **RF-06** Ao fim do processamento, ficam disponíveis o total de registros lidos e
  de grupos produzidos.
- **RF-07** A lógica de validação de registros e de agrupamento é independente de
  arquivos: ela opera sobre linhas de texto, podendo ser testada sem disco.

## 5. Requisitos de integridade

Cada violação abaixo é um **erro de entrada**. O processamento é interrompido no
primeiro erro, e a mensagem informa o **número da linha** (contando o cabeçalho como
linha 1), o **campo** (quando aplicável) e o motivo. Nenhum grupo posterior ao erro é
produzido.

- **RI-01** Arquivo vazio ou sem cabeçalho.
- **RI-02** Cabeçalho diferente do esperado.
- **RI-03** Registro com número de campos diferente de 7.
- **RI-04** Campo que não satisfaz a regra da seção 3.2.
- **RI-05** Timestamp **menor** que o do grupo anterior (fora de ordem).
- **RI-06** Timestamp que **reaparece** depois de um grupo diferente (grupo não
  contíguo). Equivale ao RI-05 para timestamps de largura fixa.
- **RI-07** Mesmo `idMonitorado` repetido no mesmo timestamp.
- **RI-08** `medidaProtetiva` incoerente com `idsRestricaoMedida`: `true` com lista
  vazia, ou `false` com lista não vazia.
- **RI-09** `idsRestricaoMedida` contendo o próprio `idMonitorado`.

Não são validados (decisão A7 da análise):

- Constância de facção, medida protetiva ou lista de restrição de um mesmo id ao
  longo do arquivo.
- Existência, no dataset, dos ids listados em `idsRestricaoMedida`.
- Presença de todos os indivíduos em todos os timestamps.
- Intervalo entre timestamps consecutivos.

## 6. Agrupamento por timestamp

- Um grupo é a sequência **máxima de registros consecutivos** com o mesmo
  timestamp.
- O grupo termina quando aparece um registro com timestamp diferente ou quando o
  arquivo termina. O último grupo é sempre produzido, com ou sem quebra de linha
  final.
- Um arquivo apenas com o cabeçalho é válido e produz zero grupos.
- Um grupo com um único registro é válido (não gera pares, mas é produzido).
- Como os grupos precisam ser contíguos e ordenados (RI-05, RI-06), não há
  reordenação: arquivos fora de ordem são rejeitados, não corrigidos.

## 7. Processamento incremental e memória

- **RP-01** O arquivo é lido em fluxo; em nenhum momento o conteúdo inteiro é mantido
  em memória.
- **RP-02** A memória retida é proporcional ao **maior grupo** (mais o buffer de
  leitura), e não ao número total de registros ou de grupos.
- **RP-03** O processamento não mantém estado acumulado por indivíduo ou por
  timestamp já concluído, exceto contadores e o timestamp do grupo anterior.
- **RP-04** Os datasets oficiais 1 a 7 devem ser processáveis com as configurações
  padrão de memória do Node.js.

Metas de desempenho só serão definidas após medição (CLAUDE.md: não declarar
melhorias sem benchmark).

## 8. Critérios de aceitação

| ID    | Critério | Verificação |
| ----- | -------- | ----------- |
| CA-01 | `dataset1.txt` produz 500 grupos de 10 registros, totalizando 5 000 registros. | Teste automatizado |
| CA-02 | `dataset2.txt` produz 1 250 grupos de 20 registros, totalizando 25 000 registros. | Teste automatizado |
| CA-03 | O primeiro grupo do `dataset1.txt` tem timestamp `2024-01-01 00:00:00`, e o registro do id 9 tem: sem facção, `latitude` 1.64046, `longitude` −69.53947, medida protetiva `true` e restrições `[10]`. | Teste automatizado |
| CA-04 | O registro do id 7 no primeiro grupo do `dataset1.txt` tem facção `1` e lista de restrições vazia. | Teste automatizado |
| CA-05 | O mesmo conteúdo produz os mesmos grupos com terminação LF ou CRLF, com ou sem BOM, e com ou sem quebra de linha final. | Teste automatizado |
| CA-06 | Cada regra RI-01 a RI-09 tem pelo menos um teste que verifica o erro, a linha e o campo reportados. | Teste automatizado |
| CA-07 | Para cada campo da seção 3.2 há testes de valores válidos e inválidos, incluindo limites (latitude ±90, longitude ±180, `0`, zeros à esquerda, `1e3`, `0x10`, valores vazios, espaços, datas inexistentes como `2024-02-30`). | Teste automatizado |
| CA-08 | Um arquivo apenas com cabeçalho produz zero grupos sem erro. | Teste automatizado |
| CA-09 | O consumidor recebe o primeiro grupo antes de o leitor chegar ao fim de um arquivo com múltiplos grupos. | Teste automatizado |
| CA-10 | Os datasets 3, 4 e 5 são processados sem erro, com as contagens da análise (2 500 × 40, 6 667 × 60, 12 500 × 80). | Verificação manual documentada (arquivos não versionados) |
| CA-11 | O processamento do `dataset5.txt` com heap limitado (`--max-old-space-size=64`) termina sem erro de memória. | Verificação manual documentada |

## 9. Casos-limite

- Cabeçalho com BOM; cabeçalho com `\r` final (CRLF).
- Último registro sem quebra de linha final.
- Linha vazia no meio ou no fim do arquivo.
- Linha com 6 ou 8 campos; `;` sobrando no fim da linha.
- `faccaoMonitorado` e `idsRestricaoMedida` vazios simultaneamente.
- `idsRestricaoMedida` com vários ids (`"10,11"`); com vírgula sobrando (`"10,"`); com
  aspas desbalanceadas; sem aspas.
- `timestamp` sem aspas; com fuso (`...Z`); com data inexistente.
- Latitude `90.00000` e `-90.00000` (válidas); `90.00001` (inválida).
- Coordenadas sem parte fracionária (`-25`), em notação científica, com `+`.
- Id `0`, negativo, decimal ou maior que o maior inteiro seguro.
- Mesmo id duas vezes no mesmo timestamp.
- Timestamp que retrocede; timestamp que reaparece após outro grupo.
- Grupos de tamanhos diferentes no mesmo arquivo (válido).

## 10. Ambiguidades e decisões pendentes

Detalhadas na seção 5 de [`dataset-analysis.md`](dataset-analysis.md). As que afetam
esta spec:

| ID | Questão | Proposta nesta spec | Situação |
| -- | ------- | ------------------- | -------- |
| D1 | Política para registros inválidos: interromper ou descartar e continuar? | Interromper no primeiro erro (seção 5). | Requer aprovação |
| D2 | Aspas obrigatórias em `timestamp` e na lista de restrições? | Obrigatórias, como em 100 % dos dados observados. | Requer aprovação |
| D3 | Formato da lista com vários ids (A11). | Separados por `,`, sem espaços. | Hipótese: não observado |
| D4 | `medidaProtetiva` incoerente com a lista (A6). | Erro de entrada (RI-08). | Requer aprovação |
| D5 | Atributos de um id variando entre timestamps (A7). | Não validar; usar os atributos de cada registro. | Requer aprovação |
| D6 | Arquivos fora de ordem. | Rejeitar (RI-05/06), sem reordenação externa. | Requer aprovação |
| D7 | Linhas vazias. | Ignorar. | Requer aprovação |

# Spec 001 — Processamento de datasets

- **Status:** Implementada; leitura a partir de bytes (seção 12) implementada na
  branch `perf/optimize-dataset-processing`
- **Documentos relacionados:** [`plan.md`](plan.md), [`tasks.md`](tasks.md),
  [`dataset-analysis.md`](dataset-analysis.md)

## 1. Objetivo

Ler um arquivo de registros de localização de indivíduos monitorados, converter cada
registro para uma representação tipada e entregá-los **agrupados por timestamp**, em
ordem de leitura, para a etapa de detecção de encontros (spec 002).

O processamento deve funcionar com arquivos de centenas de megabytes (≈12 milhões de
registros), lendo o arquivo de forma incremental, sem carregá-lo inteiro em memória,
e produzir sempre o mesmo resultado para a mesma entrada.

## 2. Diretriz de escopo

Esta spec implementa apenas o que o enunciado descreve e os gabaritos oficiais
confirmam. Ela **não** cria regras de negócio, precedências entre classificações nem
restrições baseadas em cenários hipotéticos. As validações existem apenas para
garantir que cada campo possa ser convertido para o tipo esperado e que o
agrupamento em streaming seja correto. Nenhuma validação ou transformação altera
dados válidos.

## 3. Fora de escopo

- Cálculo de distância, detecção e classificação de encontros (spec 002).
- Indexação espacial e otimizações (spec 003).
- Geração e validação do arquivo de saída (spec 004).
- Interface de linha de comando.

## 4. Formato de entrada

### 4.1 Arquivo

- Texto UTF-8. Um BOM UTF-8 no início, se presente, é ignorado.
- Quebras de linha `LF` ou `CRLF`. Um `CR` isolado também encerra a linha, como no
  `readline` usado pela primeira implementação; a seção 12 preserva esse
  comportamento.
- A última linha pode ou não terminar com quebra de linha.
- A primeira linha é o cabeçalho, com os sete campos do enunciado:

  ```
  idMonitorado;faccaoMonitorado;timestamp;latitude;longitude;medidaProtetiva;idsRestricaoMedida
  ```

- Cada linha seguinte é um registro com **7 campos** separados por `;`.
- Linhas vazias são ignoradas.

### 4.2 Campos

| # | Campo                | Formato aceito | Valor resultante |
| - | -------------------- | -------------- | ---------------- |
| 1 | `idMonitorado`       | Inteiro decimal não negativo. | Inteiro |
| 2 | `faccaoMonitorado`   | Vazio, ou inteiro decimal não negativo. | Inteiro, ou `null` (sem facção) |
| 3 | `timestamp`          | `YYYY-MM-DD HH:MM:SS`, opcionalmente entre aspas duplas. | O texto do input, **removidas apenas as aspas delimitadoras** |
| 4 | `latitude`           | Número decimal (sinal opcional; parte fracionária opcional) entre −90 e 90. | Número de ponto flutuante |
| 5 | `longitude`          | Número decimal (sinal opcional; parte fracionária opcional) entre −180 e 180. | Número de ponto flutuante |
| 6 | `medidaProtetiva`    | `true` ou `false`. | Booleano |
| 7 | `idsRestricaoMedida` | Vazio, ou um ou mais inteiros separados por `,`, opcionalmente entre aspas duplas (ex.: `"10"`, `"10,11"`). | Lista de inteiros na ordem do input (vazia se o campo for vazio) |

Notas:

- O timestamp é tratado como texto. Dois registros têm o mesmo timestamp se e
  somente se os textos forem **idênticos**. Não há conversão de fuso nem
  normalização.
- O formato `YYYY-MM-DD HH:MM:SS` é exigido porque a verificação de ordem cronológica
  (seção 6) compara os textos: com largura fixa, a ordem lexicográfica é a ordem
  cronológica.
- As coordenadas são convertidas para número sem arredondamento adicional. O valor
  numérico é o mesmo usado pelos gabaritos (`-44.63520` → `-44.6352`).
- Os intervalos de latitude e longitude são os limites geográficos dos valores; não
  são regras de negócio.

## 5. Requisitos funcionais

- **RF-01** O processamento recebe o caminho de um arquivo e produz uma sequência de
  **grupos**, cada um com um timestamp e os registros daquele timestamp.
- **RF-02** Os grupos são produzidos na ordem do arquivo, e os registros de cada grupo
  mantêm a ordem do arquivo.
- **RF-03** Cada registro expõe: id, facção (ou ausência), timestamp, latitude,
  longitude, indicador de medida protetiva e lista de ids de restrição.
- **RF-04** O processamento é **incremental**: cada grupo fica disponível para o
  consumidor assim que é concluído, sem aguardar o fim do arquivo.
- **RF-05** O consumidor controla o ritmo: o leitor não avança além do grupo seguinte
  enquanto o consumidor não pede mais grupos.
- **RF-06** A conversão de registros e o agrupamento são independentes de arquivos:
  operam sobre linhas de texto ou sobre blocos de bytes (seção 12) e podem ser
  testados sem disco.

## 6. Erros de entrada

Cada situação abaixo é um **erro de entrada**. O processamento é interrompido no
primeiro erro. A mensagem informa o **arquivo**, o **número da linha** (cabeçalho =
linha 1), o **campo** (quando aplicável) e o motivo. Nenhum grupo posterior ao erro é
produzido.

- **E-01** Arquivo inexistente ou ilegível.
- **E-02** Arquivo vazio (sem cabeçalho).
- **E-03** Cabeçalho diferente do esperado.
- **E-04** Registro com número de campos diferente de 7.
- **E-05** Campo fora do formato da seção 4.2.
- **E-06** Timestamp **menor** que o do grupo anterior (fora de ordem cronológica).

A E-06 é necessária porque o agrupamento em streaming depende de os registros de um
mesmo timestamp serem contíguos. Um timestamp que reaparece depois de outro grupo é
necessariamente menor que o anterior e, portanto, também é detectado por ela.

O processamento **não** valida regras que o enunciado não define, entre elas:
coerência entre `medidaProtetiva` e `idsRestricaoMedida`, existência dos ids
listados, autorreferência na lista, repetição de id no mesmo timestamp, constância
dos atributos de um id ao longo do arquivo, presença de todos os indivíduos em todos
os timestamps e intervalo entre timestamps.

## 7. Agrupamento por timestamp

- Um grupo é a sequência **máxima de registros consecutivos** com timestamp
  idêntico.
- O grupo termina quando aparece um registro com timestamp diferente ou quando o
  arquivo termina. O último grupo é sempre produzido, com ou sem quebra de linha
  final.
- Um arquivo apenas com o cabeçalho é válido e produz zero grupos.
- Um grupo com um único registro é válido.
- Não há reordenação: arquivos fora de ordem são rejeitados (E-06), não corrigidos.

## 8. Processamento incremental e memória

- **RP-01** O arquivo é lido em fluxo; em nenhum momento o conteúdo inteiro é mantido
  em memória.
- **RP-02** A memória retida pelo processamento é proporcional ao **maior grupo**
  (mais o buffer de leitura), e não ao número total de registros ou de grupos.
- **RP-03** Não há estado acumulado por indivíduo ou por grupo já entregue, exceto o
  timestamp do grupo anterior e o número da linha.

Não há limite de memória ou de tempo definido nesta spec. Tempo e memória são
medidos como **diagnóstico** (CA-10).

## 9. Critérios de aceitação

| ID    | Critério | Verificação |
| ----- | -------- | ----------- |
| CA-01 | `dataset1.txt` produz 500 grupos de 10 registros, totalizando 5 000 registros. | Teste automatizado |
| CA-02 | `dataset2.txt` produz 1 250 grupos de 20 registros, totalizando 25 000 registros. | Teste automatizado |
| CA-03 | Em todos os registros dos datasets 1 e 2, timestamp, coordenadas, facção, medida protetiva e restrições correspondem ao texto do input, convertidos segundo a seção 4.2. | Teste automatizado, comparando com uma leitura independente do arquivo |
| CA-04 | As posições dos encontros em `respostas1.json` e `respostas2.json` são idênticas às coordenadas convertidas dos registros correspondentes. | Teste automatizado |
| CA-05 | O mesmo conteúdo produz os mesmos grupos com terminação LF ou CRLF, com ou sem BOM e com ou sem quebra de linha final. | Teste automatizado |
| CA-06 | Cada erro E-01 a E-06 tem pelo menos um teste que verifica arquivo, linha e campo reportados. | Teste automatizado |
| CA-07 | Cada campo da seção 4.2 tem testes de valores aceitos e rejeitados, incluindo `idsRestricaoMedida` com vários ids. | Teste automatizado |
| CA-08 | Um arquivo apenas com cabeçalho produz zero grupos sem erro. | Teste automatizado |
| CA-09 | O consumidor recebe o primeiro grupo antes de o leitor consumir as linhas além do início do segundo grupo. | Teste automatizado |
| CA-10 | Tempo, registros, grupos e memória são medidos com os datasets disponíveis localmente (1 a 5) e registrados no `plan.md`. | Medição manual documentada |

## 10. Casos-limite

- Cabeçalho com BOM; cabeçalho e registros com `\r` final (CRLF).
- Último registro sem quebra de linha final.
- Linha vazia no meio ou no fim do arquivo.
- Linha com 6 ou 8 campos.
- `faccaoMonitorado` e `idsRestricaoMedida` vazios no mesmo registro.
- `idsRestricaoMedida` com um ou vários ids, com ou sem aspas.
- `timestamp` com ou sem aspas.
- Latitude e longitude nos limites (±90, ±180).
- Grupos de tamanhos diferentes no mesmo arquivo.
- Timestamp que retrocede; timestamp que reaparece depois de outro grupo.

## 11. Decisões registradas

| ID | Questão | Decisão |
| -- | ------- | ------- |
| D1 | Registros inválidos. | Interromper no primeiro erro (seção 6). |
| D2 | Aspas em `timestamp` e na lista de restrições. | Opcionais; quando presentes, são removidas. |
| D3 | Lista com vários ids. | Ids separados por `,`. |
| D4 | Validações não definidas pelo enunciado (coerência, duplicidade, autorreferência, constância). | Não são aplicadas. |
| D5 | Arquivos fora de ordem cronológica. | Rejeitados (E-06). |
| D6 | Linhas vazias. | Ignoradas. |
| D7 | Limites de memória. | Não definidos; medição diagnóstica (CA-10). |
| D8 | Leitura a partir de bytes (seção 12). | Adotada em `readDataset`; a leitura com `readline` continua disponível como referência (`readDatasetLines`). |

## 12. Leitura a partir de bytes

### 12.1 Motivo

O profiling dos datasets 6 e 7 mostrou que leitura, parsing e agrupamento ocupavam
cerca de 70 % do tempo total com `spatialHash`. No dataset 7 eram ≈11,2 s de
≈15,5 s. O custo vinha de criar, para cada uma das 12 milhões de linhas, uma
string, um array de 7 campos, 4 testes de expressão regular e uma iteração
assíncrona do `readline`. Esta seção define um leitor que converte os registros
direto dos bytes do arquivo, sem alterar nenhuma regra das seções 4 a 8.

### 12.2 Requisitos

- **RB-01 Mesmo resultado.** Para qualquer arquivo, `readDataset` produz os mesmos
  grupos, com os mesmos registros (valores e tipos), na mesma ordem, e os mesmos
  erros (mensagem, arquivo, linha e campo) que a leitura de referência:
  decodificação UTF-8, divisão em linhas pelo `readline` e `groupByTimestamp`.
  Grupos produzidos antes de um erro também são os mesmos.
- **RB-02 Caminho rápido restrito.** Só as linhas num subconjunto canônico do
  formato da seção 4.2 são convertidas direto dos bytes. Qualquer outra linha
  (cabeçalho, linha vazia, com `CR` isolado, fora do subconjunto ou inválida) é
  decodificada e convertida por `parseRecord`. As regras de validação e as
  mensagens de erro continuam num único lugar e não são flexibilizadas.
- **RB-03 Números exatos.** Os ids e as coordenadas do caminho rápido têm o mesmo
  valor `double` que `Number()` produziria, inclusive o sinal de zero.
- **RB-04 Linhas entre blocos.** Uma linha dividida entre dois ou mais blocos de
  leitura é reconstituída antes da conversão, em qualquer posição do corte (inclusive
  entre `CR` e `LF`).
- **RB-05 Terminações.** `LF`, `CRLF` e `CR` isolado, BOM no início e última linha
  sem terminação, como na seção 4.1.
- **RB-06 Memória limitada.** O arquivo é lido em blocos de tamanho fixo. Entre
  blocos, só é mantida a linha incompleta, copiada, além do estado da seção 8.
- **RB-07 Contrapressão e fechamento.** Um bloco só é lido quando o consumidor pede
  um grupo que os blocos já lidos não completam. O arquivo é fechado no fim, em erro
  e quando o consumidor interrompe a iteração.
- **RB-08 Referência preservada.** A leitura anterior continua disponível como
  `readDatasetLines` e é usada para validar a nova.

### 12.3 Invariantes

- **I-B1** Para toda linha em que o caminho rápido devolve um registro,
  `parseRecord` devolveria um registro igual (`deepStrictEqual`, com `Object.is`
  nas coordenadas).
- **I-B2** A numeração das linhas segue a divisão do `readline`; cada linha
  incrementa o contador uma vez, pelo caminho rápido ou pelo lento.
- **I-B3** O estado entre blocos é a linha incompleta, o timestamp e os bytes do
  último timestamp, o número da linha e o grupo corrente.

### 12.4 Critérios de aceitação

| ID    | Critério | Verificação |
| ----- | -------- | ----------- |
| CA-11 | Linhas canônicas, incluindo sinais, zero negativo, limites ±90/±180, 15 dígitos, ids com zeros à esquerda e listas com e sem aspas, produzem exatamente o registro de `parseRecord`. | Teste automatizado |
| CA-12 | Linhas fora do subconjunto, válidas ou inválidas, são entregues a `parseRecord`. | Teste automatizado |
| CA-13 | 200 mil coordenadas aleatórias são iguais bit a bit a `Number()`. Em 100 mil linhas aleatórias com mutações, o caminho rápido nunca devolve um registro diferente do de `parseRecord`. | Teste automatizado (semente fixa) |
| CA-14 | O leitor por bytes e a referência produzem os mesmos grupos e erros com blocos de **todos** os tamanhos, de 1 byte ao arquivo inteiro: LF, CRLF, CR isolado, BOM, linhas vazias, sem quebra final, linhas não canônicas, cada erro de E-02 a E-06 e bytes UTF-8 inválidos. | Teste automatizado |
| CA-15 | O arquivo é fechado no fim, em erro e em interrupção pelo consumidor. | Teste automatizado |
| CA-16 | Datasets 1 a 7: `readDataset` e `readDatasetLines` produzem os mesmos grupos em todo o arquivo. | Script `compare-readers` (plano, seção 12) |
| CA-17 | Tempo e memória da leitura medidos antes e depois, nas mesmas condições. | Medição documentada no plano |

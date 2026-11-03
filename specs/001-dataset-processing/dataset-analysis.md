# Análise dos datasets oficiais e validação dos gabaritos

Documento complementar da especificação `001-dataset-processing`. Registra o que foi
**observado** nos dados oficiais e separa explicitamente essas observações das
**decisões propostas**, que foram revisadas e decididas nas especificações 001 a 004.

## 1. Escopo e método

### 1.1 Arquivos analisados

| Arquivo        | Tamanho (bytes) | Forma de análise                                                  |
| -------------- | --------------: | ----------------------------------------------------------------- |
| `dataset1.txt` |         261 093 | Completo                                                          |
| `dataset2.txt` |       1 310 093 | Completo                                                          |
| `dataset3.txt` |       5 265 971 | Completo                                                          |
| `dataset4.txt` |      21 120 768 | Completo                                                          |
| `dataset5.txt` |      52 836 281 | Completo                                                          |
| `dataset6.txt` |     423 411 895 | **Parcial**: primeiros e últimos 256 KiB (HTTP Range), sem download integral |
| `dataset7.txt` |     638 210 371 | **Parcial**: primeiros e últimos 256 KiB (HTTP Range), sem download integral |
| `respostas1.json` |        1 344 | Completo (gabarito do dataset 1)                                  |
| `respostas2.json` |        2 029 | Completo (gabarito do dataset 2)                                  |

Os datasets 3, 4 e 5 não possuem gabarito, mas foram analisados integralmente por
serem pequenos e permitirem verificar se as características dos dois primeiros se
mantêm. Os datasets 6 e 7 não foram baixados nesta análise inicial (restrição da etapa).
Depois, foram processados integralmente na spec 004.

### 1.2 Método

- Scripts descartáveis em Node.js (fora do repositório), com leitura em streaming
  via `node:readline`, verificando cada campo com expressões regulares estritas.
- Para os datasets 1 e 2: cálculo por força bruta de **todos os pares** de
  indivíduos em **cada timestamp** e comparação com os gabaritos.
- Nenhum dado bruto foi versionado. Os arquivos ficaram em `data/` (ignorado pelo Git).

### 1.3 Fonte das regras

As regras de negócio citadas como "enunciado" são as do desafio técnico:
- comparação apenas de posições com timestamp idêntico;
- fórmula de Haversine com raio de 6 371 000 m;
- encontro com distância estritamente menor que 20 m;
- tipos `generico`, `faccao` e `protetiva`;
- um registro por par e timestamp;
- estrutura do JSON de saída.

Elas estão consolidadas nas especificações 001 e 002.

Legenda das classificações usadas nas conclusões:

- **[Enunciado]** Confirmada pelo enunciado.
- **[Exemplos]** Confirmada pelos exemplos disponíveis (datasets 1–2 com gabarito,
  e 3–5 quando aplicável).
- **[Hipótese]** Hipótese ainda não comprovada.

## 2. Observações: estrutura de entrada

### 2.1 Formato

Cabeçalho idêntico em todos os sete arquivos (inclusive 6 e 7, pela amostra):

```
idMonitorado;faccaoMonitorado;timestamp;latitude;longitude;medidaProtetiva;idsRestricaoMedida
```

Exemplos reais (dataset 1):

```
7;1;"2024-01-01 00:00:00";-13.06443;-46.56289;false;
9;;"2024-01-01 00:00:00";1.64046;-69.53947;true;"10"
```

| # | Campo                | Formato observado                                        | Vazio? |
| - | -------------------- | -------------------------------------------------------- | ------ |
| 1 | `idMonitorado`       | Inteiro positivo, sem aspas (`1`..`N`)                   | Nunca  |
| 2 | `faccaoMonitorado`   | Inteiro positivo sem aspas, ou vazio                     | Sim (sem facção) |
| 3 | `timestamp`          | Entre aspas duplas: `"YYYY-MM-DD HH:MM:SS"`, sem fuso    | Nunca  |
| 4 | `latitude`           | Decimal com sinal opcional e **exatamente 5 casas**      | Nunca  |
| 5 | `longitude`          | Decimal com sinal opcional e **exatamente 5 casas**      | Nunca  |
| 6 | `medidaProtetiva`    | `true` ou `false` (minúsculas, sem aspas)                | Nunca  |
| 7 | `idsRestricaoMedida` | Vazio, ou lista entre aspas (`"10"`)                     | Sim    |

- Separador `;`. Nenhuma linha com contagem de campos diferente de 7.
- Nenhum `;` aparece dentro de campos entre aspas.
- Todas as listas de restrição observadas têm **exatamente 1 id**. O formato com
  múltiplos ids (presumivelmente separados por vírgula) **não foi observado**.
- Codificação ASCII/UTF-8, **sem BOM**, quebras de linha **LF** (nenhum `\r`).
- Datasets 1–5 **não** terminam com quebra de linha; datasets 6 e 7 **terminam**
  com `\n`. Nenhuma linha em branco no meio dos arquivos.
- Nenhum campo inválido em 1 530 020 registros verificados (datasets 1–5) nem nas
  amostras dos datasets 6 e 7.

### 2.2 Estatísticas

| Dataset | Registros  | Indivíduos | Timestamps | Indiv./timestamp (mín/méd/máx) | Facções | Membros c/ facção | Com medida protetiva | Primeiro → último timestamp |
| ------- | ---------: | ---------: | ---------: | ------------------------------ | ------: | ----------------: | -------------------: | --------------------------- |
| 1       |      5 000 |         10 |        500 | 10 / 10 / 10                   |       1 |                 2 |                    1 | 2024-01-01 00:00:00 → 00:41:35 |
| 2       |     25 000 |         20 |      1 250 | 20 / 20 / 20                   |       2 |                 4 |                    1 | 2024-01-01 00:00:00 → 01:44:05 |
| 3       |    100 000 |         40 |      2 500 | 40 / 40 / 40                   |       3 |                 6 |                    2 | 2024-01-01 00:00:00 → 03:28:15 |
| 4       |    400 020 |         60 |      6 667 | 60 / 60 / 60                   |       5 |                10 |                    3 | 2024-01-01 00:00:00 → 09:15:30 |
| 5       |  1 000 000 |         80 |     12 500 | 80 / 80 / 80                   |       7 |                14 |                    4 | 2024-01-01 00:00:00 → 17:21:35 |
| 6 (amostra) | ≈8 000 000 (estimado) | 100 | ≈80 000 (estimado) | 100 nas amostras     |     ≥ 9 |                 — |                    — | 2024-01-01 00:00:00 → 2024-01-05 15:06:35 |
| 7 (amostra) | ≈12 000 000 (estimado) | 120 | ≈100 000 (estimado) | 120 nas amostras    |    ≥ 12 |                 — |                    — | 2024-01-01 00:00:00 → 2024-01-06 18:53:15 |

As estimativas dos datasets 6 e 7 assumem passo constante de 5 s e 100/120
indivíduos por timestamp, como nas amostras: (último − primeiro)/5 s + 1 timestamps.
São coerentes com os "≈8 e ≈12 milhões" informados e com o tamanho em bytes
(≈53 bytes/linha). **Não foram verificadas no arquivo completo.**

### 2.3 Ordenação e agrupamento

Observado em todos os datasets 1–5 (e nas amostras de 6 e 7):

- Timestamps em ordem **não decrescente**; **0** ocorrências fora de ordem.
- Registros de um mesmo timestamp são **contíguos** (nenhum timestamp reaparece
  depois de outro).
- Intervalo constante de **5 segundos** entre timestamps consecutivos.
- **Todos** os indivíduos aparecem em **todos** os timestamps (grupos de tamanho fixo).
- Dentro de cada timestamp, ids em **ordem crescente**.
- **0** ids duplicados no mesmo timestamp.
- Nos datasets 6 e 7 os timestamps atravessam a virada de dia (`2024-01-0X`).

### 2.4 Consistência dos atributos por indivíduo

- `faccaoMonitorado`, `medidaProtetiva` e `idsRestricaoMedida` são **constantes**
  para cada id ao longo de todo o arquivo (0 variações, datasets 1–5).
- Cada facção tem **exatamente 2 membros** (datasets 1–5).
- `medidaProtetiva = true` ⇔ `idsRestricaoMedida` não vazio (0 exceções).
- O id referenciado na lista sempre existe no dataset, nunca é o próprio indivíduo
  e sempre tem `medidaProtetiva = false`.
- A relação é **unidirecional**: o alvo nunca lista de volta quem o referencia.
- Indivíduos com medida protetiva e seus alvos **nunca têm facção**.
- Coordenadas: latitude em [−33,75; 5,27], longitude em [−73,99; −34,79]
  (aproximadamente o território brasileiro). Nenhuma fora dos intervalos válidos.

## 3. Observações: análise e validação dos gabaritos

### 3.1 Estrutura do gabarito

Cada encontro tem as chaves, nesta ordem:
`tipo`, `monitoradosEncontro`, `timestamp`, `posicoes`, `distanciaMetros`.

```json
{
  "tipo": "protetiva",
  "monitoradosEncontro": [9, 10],
  "timestamp": "2024-01-01 00:16:45",
  "posicoes": { "9": { "lat": 1.83355, "lon": -69.5461 }, "10": { "lat": 1.83351, "lon": -69.54618 } },
  "distanciaMetros": 9.941503149375345
}
```

- Valores de `tipo` observados: `generico`, `faccao`, `protetiva`.
- `timestamp` sem aspas internas, mesmo texto do campo de entrada.
- `posicoes` reproduz exatamente as coordenadas de entrada daquele timestamp,
  como número JSON (`"-44.63520"` na entrada → `-44.6352` na saída).
- Os dois arquivos são byte a byte iguais a `JSON.stringify(lista, null, 2)`:
  indentação de 2 espaços, LF, **sem** quebra de linha final.

### 3.2 Comparação com força bruta

| Dataset | Pares (par, timestamp) com d < 20 m | Encontros no gabarito | Interseção | Só no cálculo | Só no gabarito |
| ------- | ----------------------------------: | --------------------: | ---------: | ------------: | -------------: |
| 1       |                                   4 |                     4 |          4 |             0 |              0 |
| 2       |                                   6 |                     6 |          6 |             0 |              0 |

Encontros do gabarito e atributos dos participantes:

| DS | Par    | Timestamp            | `tipo`      | Facções  | Relação de restrição | Distância oficial (m) |
| -- | ------ | -------------------- | ----------- | -------- | -------------------- | --------------------: |
| 1  | 4–6    | 2024-01-01 00:05:15  | `generico`  | —/—      | não                  |      9.33522817789823 |
| 1  | 3–5    | 2024-01-01 00:10:20  | `generico`  | —/—      | não                  |     8.882771981092958 |
| 1  | 9–10   | 2024-01-01 00:16:45  | `protetiva` | —/—      | 9 lista 10           |     9.941503149375345 |
| 1  | 7–8    | 2024-01-01 00:36:00  | `faccao`    | 1/1      | não                  |     8.895594131622975 |
| 2  | 10–11  | 2024-01-01 00:02:05  | `faccao`    | 2/2      | não                  |     10.81640474094182 |
| 2  | 12–13  | 2024-01-01 00:29:50  | `protetiva` | —/—      | 12 lista 13          |     8.909619516337239 |
| 2  | 3–19   | 2024-01-01 00:35:55  | `generico`  | —/—      | não                  |    10.205209934010645 |
| 2  | 6–7    | 2024-01-01 00:43:35  | `generico`  | —/—      | não                  |     9.349741643529189 |
| 2  | 4–5    | 2024-01-01 01:26:30  | `generico`  | —/—      | não                  |     8.811738897421028 |
| 2  | 8–9    | 2024-01-01 01:43:00  | `faccao`    | 1/1      | não                  |     8.892813491126276 |

### 3.3 Precisão numérica da distância

Foram testadas 36 variantes algebricamente equivalentes de Haversine. A variante
abaixo reproduz **bit a bit** as 10 distâncias oficiais (10/10, também com a ordem
dos pontos invertida):

```
toRad(x) = x * Math.PI / 180
a = sin²(toRad(lat2 − lat1) / 2) + cos(toRad(lat1)) · cos(toRad(lat2)) · sin²(toRad(lon2 − lon1) / 2)
d = 2 · 6371000 · asin(√a)
```

| Variante                                                   | Exatas | Erro máximo (m) |
| ---------------------------------------------------------- | -----: | --------------: |
| Diferença em graus, depois `* PI / 180`, `asin`            |  10/10 |               0 |
| Igual, mas `atan2(√a, √(1−a))`                             |   9/10 |        1,8·10⁻¹⁵ |
| Igual, mas `x * (PI / 180)`                                |   9/10 |        1,8·10⁻¹⁵ |
| `x / 180 * PI`                                             |   7/10 |        1,8·10⁻¹⁵ |
| Converter cada coordenada para radianos e depois subtrair  |   0/10 |        7,9·10⁻¹⁰ |

Conclusão: as diferenças entre variantes ficam abaixo de 10⁻⁹ m e não afetam o limiar
de 20 m nos dados observados, mas afetam a **igualdade exata** com o gabarito.

### 3.4 Pares ausentes e margem do limiar

- Nos datasets 1 e 2 **não existe** par abaixo de 20 m ausente do gabarito, portanto
  **nenhuma regra de exclusão foi observada**.
- Menor distância ≥ 20 m entre pares no mesmo timestamp: 28,27 m (dataset 1, par 4–6,
  timestamp seguinte ao encontro). Dataset 2: nenhum outro par abaixo de 40 m.
- Nenhum par com distância em [19,9; 20) em nenhum dataset 1–5; a menor distância acima de 20 m nos datasets 1–5 é 20,73 m (dataset 3, par 28–31). O caso-limite
  "exatamente 20 m" **não é exercitado** pelos exemplos.
- Os pares se aproximam e se afastam: o par 4–6 do dataset 1 está a 9,34 m em
  00:05:15 e a 28,27 m em 00:05:20.

### 3.5 Pares abaixo de 20 m nos datasets sem gabarito

| Dataset | Registros (par, timestamp) < 20 m | Pares distintos | Tipo `faccao`* | Tipo `protetiva`* | Demais |
| ------- | --------------------------------: | --------------: | ------------: | ---------------: | -----: |
| 3       |                                10 |               8 |             3 |                2 |      5 |
| 4       |                                15 |              15 |             5 |                3 |      7 |
| 5       |                                21 |              21 |             7 |                4 |     10 |

\* Mesmos critérios observados nos gabaritos (seções 4.4 e 4.5).

**Caso relevante:** no dataset 3, o par **28–31** fica abaixo de 20 m em **três
timestamps consecutivos** (01:00:30 → 12,87 m; 01:00:35 → 8,70 m; 01:00:40 → 13,30 m).
Não há gabarito para confirmar a saída esperada (ver seção 4.8).

Em todos os datasets 1–5, os participantes de encontros "genéricos" não têm facção,
não têm medida protetiva e não são alvo de restrição. Ou seja, **nenhum caso misto**
(facções diferentes, membro de facção com não membro, pessoa com medida protetiva
próxima de terceiros) ocorre abaixo de 20 m.

## 4. Conclusões

| #  | Questão | Conclusão | Classificação |
| -- | ------- | --------- | ------------- |
| 4.1 | Haversine com R = 6 371 000 m | Sim. 10/10 distâncias reproduzidas bit a bit com a variante da seção 3.3. | **[Enunciado]** + **[Exemplos]** |
| 4.2 | Todos os encontros < 20 m | Sim. Maior distância oficial: 10,816 m. | **[Enunciado]** + **[Exemplos]** |
| 4.3 | Todos os pares elegíveis < 20 m aparecem | Sim, nos datasets 1 e 2 (4/4 e 6/6, sem extras). | **[Exemplos]** |
| 4.3b | Comparação estrita (`d = 20` não é encontro) | Não exercitado pelos dados. | **[Enunciado]** |
| 4.4 | Identificação de facção | Ambos com `faccaoMonitorado` não vazio e igual → `faccao` (3 casos). | **[Exemplos]** |
| 4.4b | Facções diferentes, ou facção × sem facção | Não observado. | **[Hipótese]** |
| 4.5 | Identificação de medida protetiva | Um dos dois lista o outro em `idsRestricaoMedida` → `protetiva` (2 casos, sempre o indivíduo com `medidaProtetiva=true` listando o alvo). | **[Exemplos]** |
| 4.5b | Relação verificada nos dois sentidos | Só o sentido "quem tem a medida lista o alvo" foi observado. | **[Hipótese]** |
| 4.5c | `medidaProtetiva` incoerente com a lista | Nunca ocorre (true ⇔ lista não vazia). Papel exato do booleano é indeterminado. | **[Hipótese]** |
| 4.6 | Pessoa com medida protetiva em encontro genérico | Não observado: essas pessoas só se aproximaram do próprio alvo. | **[Hipótese]** |
| 4.7 | Par que satisfaz mais de uma classificação | Não ocorre (pessoas com medida e alvos nunca têm facção). Precedência indeterminada. | **[Hipótese]** |
| 4.8 | Unicidade por par e timestamp | Gabaritos: nenhum (par, timestamp) repetido; par não ordenado (ids em ordem crescente). Repetição do mesmo par em timestamps consecutivos não ocorre nos gabaritos, mas ocorre no dataset 3. | Regra: **[Enunciado]**; comportamento em timestamps consecutivos: **[Hipótese]** |
| 4.9 | Ordenação dos resultados | Gabaritos em ordem crescente de timestamp (= ordem de entrada); `monitoradosEncontro` em ordem crescente. Nenhum timestamp com 2+ encontros nos exemplos. | **[Exemplos]**; desempate no mesmo timestamp: **[Hipótese]** |
| 4.9b | Ordem crescente vs. "pessoa com medida primeiro" em `protetiva` | Indistinguível: em todos os casos (datasets 1–5) o id com medida é menor que o do alvo. | **[Hipótese]** |
| 4.9c | Ordem das chaves de `posicoes` | Não informativa: `JSON.stringify` ordena chaves inteiras de forma crescente. | — |
| 4.10 | Precisão numérica | Distâncias são `double` serializados por `JSON.stringify`; reprodução exata exige a variante da seção 3.3. Posições são o `Number` do texto de entrada. | **[Exemplos]** |

## 5. Decisões propostas e ambiguidades identificadas

As decisões abaixo **não são observações**. As marcadas como **Decidido** foram aprovadas na revisão da spec 001. As demais foram decididas nas specs 002 e 004, seguindo a diretriz de implementar apenas regras do enunciado confirmadas pelos gabaritos, sem precedências ou restrições hipotéticas. A tabela registra a recomendação feita durante a análise. A decisão final de cada item está na spec indicada.

| ID  | Ambiguidade | Recomendação | Justificativa | Spec |
| --- | ----------- | ------------ | ------------- | ---- |
| A1 | Fórmula exata de Haversine | Implementar a variante da seção 3.3 e comparar com o gabarito por igualdade exata; tolerância apenas como diagnóstico. | Reproduz 10/10 bit a bit; V8 usa `Math.sin/cos/asin` determinísticos. | 002 |
| A2 | Mesmo par em timestamps consecutivos (dataset 3, par 28–31) | Emitir **um registro por (par, timestamp)**, sem fundir episódios. | É a regra literal do enunciado; fundir exigiria uma regra não documentada. **Confirmar com o avaliador.** | 002 |
| A3 | Par elegível para mais de uma classificação | **Requer decisão na spec 002**, com base no enunciado. Nenhuma precedência é proposta. | Não ocorre nos dados 1–5; definir precedência sem respaldo seria uma regra hipotética. | 002 |
| A4 | Pessoa com medida protetiva próxima de alguém fora da lista | Classificar como `generico`. | A relação protetiva é definida pela lista; não ocorre nos dados 1–5. | 002 |
| A5 | Relação protetiva em um só sentido | Considerar `protetiva` se **qualquer** um dos dois listar o outro. | Encontro é simétrico; nos dados a relação é unidirecional. | 002 |
| A6 | `medidaProtetiva` incoerente com a lista | **Decidido (spec 001):** não validar; os campos são convertidos como estão. | O enunciado não define essa regra. | 001 |
| A7 | Atributos do indivíduo mudam entre timestamps | **Decidido (spec 001):** usar os atributos de cada registro, sem validação cruzada. | O enunciado não define essa regra. | 001 |
| A8 | Ordem de múltiplos encontros no mesmo timestamp | Ordenar por (menor id, maior id) dentro do timestamp. | Determinístico; nenhum exemplo contradiz. | 004 |
| A9 | Ordem dos ids em `monitoradosEncontro` | Crescente. | Coincide com 10/10 exemplos; a alternativa não é distinguível. | 004 |
| A10 | Formato do arquivo de saída | `JSON.stringify(lista, null, 2)`, sem quebra de linha final. | Byte a byte igual aos gabaritos. | 004 |
| A11 | Lista de restrição com vários ids | **Decidido (spec 001):** ids separados por `,`, aspas opcionais. | Formato documentado no enunciado; não observado nos dados. | 001 |
## 6. Características relevantes para leitura em streaming

- Os registros já chegam agrupados e ordenados por timestamp, então um único passe
  com estado limitado ao grupo corrente é suficiente.
- Tamanho do grupo = número de indivíduos (até 120 nas amostras); memória por
  grupo é desprezível em relação ao arquivo (até 638 MB).
- O fim de arquivo pode ou não ter `\n`, e o último grupo precisa ser emitido em
  ambos os casos.
- O cabeçalho é obrigatório e idêntico em todos os arquivos.
- O timestamp tem largura fixa (`YYYY-MM-DD HH:MM:SS`); a comparação lexicográfica
  equivale à cronológica, sem necessidade de converter para `Date`.

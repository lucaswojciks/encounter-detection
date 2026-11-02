# Encounter Detection

Aplicação em **TypeScript e Node.js** para identificar encontros entre indivíduos monitorados a partir de registros de geolocalização. O programa recebe um arquivo `.txt` e produz um JSON com os encontros encontrados, conforme o formato definido no desafio técnico da Spacecom.

## Instalação e execução

**Requisitos:** Node.js 22 ou superior e npm.

Na pasta do projeto, instale as dependências e compile o código:

```bash
npm ci
npm run build
```

Para processar um arquivo, informe seu caminho:

```bash
npm start -- data/dataset1.txt
```

O resultado será salvo em `outputs/encontros-dataset1.json`. Também é possível escolher o destino:

```bash
npm start -- data/dataset1.txt --output resultado.json
```

A aplicação aceita qualquer arquivo compatível com o formato de entrada, não apenas os datasets do desafio.

### Obtendo os datasets

Os arquivos oficiais estão disponíveis no [bucket público da Spacecom](https://bucket-projeto-trainee.s3.sa-east-1.amazonaws.com/dataset1.txt), com nomes de `dataset1.txt` até `dataset7.txt`. Baixe os arquivos desejados e salve-os, por exemplo, na pasta `data/` do projeto. Essa pasta não é versionada.

Se os arquivos já estiverem disponíveis na sua máquina, basta informar o caminho correspondente no comando de execução. **Não é necessário acesso à internet durante o processamento.**

## Formato de entrada e saída

### Entrada

Arquivo de texto com um registro por linha e campos separados por ponto e vírgula (`;`):

```text
idMonitorado;faccaoMonitorado;timestamp;latitude;longitude;medidaProtetiva;idsRestricaoMedida
4;;"2024-01-01 00:05:15";-31.93195;-40.61438;false;
6;;"2024-01-01 00:05:15";-31.93187;-40.61435;false;
```

| Campo | Descrição |
| --- | --- |
| `idMonitorado` | Identificador do indivíduo. |
| `faccaoMonitorado` | Identificador da facção, quando houver. |
| `timestamp` | Data e hora do posicionamento (`YYYY-MM-DD HH:MM:SS`). |
| `latitude`, `longitude` | Coordenadas geográficas. |
| `medidaProtetiva` | Indicador de medida protetiva (`true` ou `false`). |
| `idsRestricaoMedida` | Identificadores dos agressores relacionados à medida protetiva, separados por vírgula, quando houver. |

### Saída

Cada execução gera um **array JSON**. Cada item contém o tipo de encontro, os dois identificadores, o timestamp, as posições e a distância em metros:

```json
[
  {
    "tipo": "generico",
    "monitoradosEncontro": [4, 6],
    "timestamp": "2024-01-01 00:05:15",
    "posicoes": {
      "4": { "lat": -31.93195, "lon": -40.61438 },
      "6": { "lat": -31.93187, "lon": -40.61435 }
    },
    "distanciaMetros": 9.33522817789823
  }
]
```

O campo `tipo` pode assumir os valores `generico`, `faccao` ou `protetiva`.

## Lógica de detecção

O algoritmo analisa as posições de indivíduos que possuem o **mesmo timestamp**. Um encontro é identificado somente quando a distância entre eles é **estritamente menor que 20 metros**, calculada pela **fórmula de Haversine**, com raio terrestre de **6.371.000 metros**.

Os encontros são classificados conforme a relação entre os indivíduos:

- **Genérico:** encontro sem relação de facção ou restrição de medida protetiva identificada.
- **Facção:** os dois indivíduos pertencem à mesma facção.
- **Protetiva:** um indivíduo está na lista de restrições de medida protetiva associada ao outro.

Cada par é registrado **uma única vez por timestamp**, independentemente da ordem dos identificadores.

O fluxo de processamento é:

```text
Arquivo de entrada → Leitura e validação → Agrupamento por timestamp
                   → Busca de pares próximos → Haversine e classificação → JSON
```

## Decisões técnicas

A implementação foi projetada para processar arquivos de diferentes tamanhos com **correção dos resultados, baixo consumo de memória e bom desempenho**.

**Leitura incremental.** Em vez de carregar o dataset inteiro na memória, a aplicação lê o arquivo em blocos e processa um grupo de timestamp por vez. O caminho de leitura otimizado interpreta diretamente os bytes no formato esperado; registros que exigem tratamento adicional são encaminhados ao parser convencional, preservando as validações.

**Varredura por latitude (`latitudeSweep`).** Uma comparação de todos os pares possíveis em cada timestamp realizaria trabalho desnecessário. A estratégia escolhida ordena as posições por latitude e aplica filtros geográficos para descartar pares que não podem estar a menos de 20 metros. A distância dos candidatos restantes é sempre confirmada com Haversine, mantendo a regra exata de detecção.

**Saída incremental e segura.** Os encontros são gravados progressivamente em um arquivo temporário, publicado como resultado final somente após a conclusão bem-sucedida do processamento. Isso evita apresentar um JSON incompleto como resultado válido em caso de falha.

Essas decisões reduzem comparações e alocações desnecessárias sem abrir mão da precisão exigida. As implementações alternativas de busca e as análises detalhadas estão disponíveis nas [especificações técnicas](specs/README.md).

## Testes

Para executar os testes automatizados:

```bash
npm test
```

A suíte cobre leitura e validação, agrupamento temporal, cálculo de distância, classificação dos encontros, busca de pares, geração do JSON e tratamento de erros.

Os testes de integração com os datasets oficiais 1 e 2 são executados quando os arquivos estão em `data/` (ou no diretório indicado pela variável `ENCOUNTER_DATA_DIR`) e são ignorados quando não estão. O restante da suíte não depende desses arquivos nem de acesso à internet.

Os resultados gerados para os sete datasets estão disponíveis na pasta [`outputs/`](outputs/).

## Estrutura do projeto

```text
src/       Implementação da CLI, leitura, detecção e escrita
scripts/   Ferramentas de validação e medição de desempenho
test/      Testes automatizados
outputs/   Resultados JSON dos sete datasets
specs/     Especificações e decisões técnicas
```

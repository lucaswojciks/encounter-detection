# Spec 004 — Saída e validação

- **Status:** Implementada
- **Depende de:** specs [001](../001-dataset-processing/spec.md),
  [002](../002-encounter-detection/spec.md) e [003](../003-spatial-optimization/spec.md)
- **Documentos relacionados:** [`plan.md`](plan.md), [`tasks.md`](tasks.md)

## 1. Objetivo

Entregar a aplicação de linha de comando que lê um dataset, detecta os encontros com
o detector existente e grava o arquivo JSON exigido pelo desafio. Também cobre as
verificações que comprovam a correção dos sete outputs oficiais.

## 2. Escopo

- Interface de linha de comando.
- Escrita incremental e segura do JSON.
- Validação dos outputs: gabaritos dos datasets 1 e 2, consistência dos datasets 1 a
  7 e equivalência entre estratégias nos datasets 6 e 7.

Fora de escopo: mudanças em leitura, Haversine, classificação, ordenação ou
estratégias de busca, além do README principal (revisão final).

## 3. Interface de linha de comando

```
encounter-detection <dataset> [--output <arquivo.json>] [--search sweep|spatial|all]
encounter-detection --help
```

- **CLI-01** `<dataset>` é obrigatório.
- **CLI-02** `--output` (ou `-o`) é opcional. Sem ele, o arquivo é
  `outputs/encontros-<nome do dataset sem extensão>.json`, relativo ao diretório
  corrente; o diretório é criado se não existir.
- **CLI-03** `--search` seleciona a estratégia: `sweep` (`latitudeSweep`, **padrão**
  desde a spec 003, seção 7), `spatial` (`spatialHash`) ou `all` (`allPairs`, para
  validação).
- **CLI-04** Ao concluir, o resumo vai para a saída padrão: dataset, arquivo de saída,
  estratégia, registros, timestamps, encontros (total e por tipo), duração e memória
  máxima (RSS).
- **CLI-05** Erros vão para a saída de erro, com mensagem que identifica a causa
  (arquivo, linha e campo quando a spec 001 os fornece).
- **CLI-06** Códigos de saída: `0` sucesso; `1` erro de entrada, de processamento ou
  de escrita; `2` uso incorreto (argumento ausente, desconhecido ou inválido); `130`
  interrupção pelo usuário (SIGINT).

## 4. Arquivo de saída

- **OUT-01** O conteúdo é um array JSON de encontros, cada um com `tipo`,
  `monitoradosEncontro`, `timestamp`, `posicoes` e `distanciaMetros`, nesta ordem
  (mapeamento da spec 002).
- **OUT-02** O texto é idêntico ao de `JSON.stringify(encontros, null, 2)`: indentação
  de 2 espaços, LF e sem quebra de linha final, como os gabaritos oficiais. Sem
  encontros, o arquivo é `[]`.
- **OUT-03** A ordem é a do detector: timestamps em ordem cronológica e, no mesmo
  timestamp, pelo menor id e depois pelo maior.
- **OUT-04** Ids e coordenadas são números JSON; a distância é o `double` calculado,
  sem arredondamento.
- **OUT-05 Escrita incremental.** Os encontros são gravados à medida que são
  detectados, com memória limitada a um buffer de tamanho fixo, sem acumular a lista
  completa.
- **OUT-06 Publicação atômica.** A escrita é feita num arquivo temporário no mesmo
  diretório do destino. Só depois do processamento completo e do fechamento do
  arquivo o temporário é renomeado para o nome final. Em caso de erro ou interrupção,
  o temporário é removido, e um arquivo final preexistente permanece intacto.
- **OUT-07 Entrada preservada.** Se o destino for o próprio dataset de entrada
  (inclusive por outro caminho para o mesmo arquivo), o processamento é recusado com
  erro e o dataset permanece intacto. A publicação atômica substituiria o arquivo de
  entrada.

## 5. Validação dos outputs

- **VAL-01** Os outputs dos datasets 1 e 2 são idênticos byte a byte a
  `respostas1.json` e `respostas2.json`, o que cobre quantidade, tipos, ids,
  timestamps, coordenadas, distâncias e estrutura.
- **VAL-02** Todo output é verificado por um validador **independente da estratégia
  de busca**, que confere:
  - JSON válido e estrutura do OUT-01 (campos obrigatórios, tipos JavaScript, ids
    inteiros em ordem crescente, chaves de `posicoes` iguais aos ids);
  - tipo em `generico`, `faccao` ou `protetiva`;
  - `distanciaMetros < 20` e igual à distância recalculada a partir de `posicoes`;
  - unicidade de (par, timestamp) e ordenação do OUT-03;
  - com o dataset, que as posições são as do registro no timestamp e que o tipo é o
    da classificação da spec 002 aplicada aos atributos do dataset;
  - contagem total e por tipo.
- **VAL-03** Datasets 6 e 7: equivalência entre `spatialHash` e `allPairs` em uma
  amostra determinística de timestamps distribuída por todo o arquivo e, se o tempo
  permitir, no arquivo inteiro.
- **VAL-04** Tempo e memória de cada dataset são registrados a partir de execuções
  reais da CLI.

## 6. Critérios de aceitação

| ID | Critério | Verificação |
| -- | -------- | ----------- |
| CA-01 | Argumentos: ajuda, ausência do dataset, opção desconhecida, `--search` inválido, `--output` sem valor. | Teste automatizado da CLI |
| CA-02 | Estratégia padrão `latitudeSweep` (antes, `spatialHash`); `--search spatial` e `--search all` produzem o mesmo arquivo. | Teste automatizado |
| CA-03 | Saída igual a `JSON.stringify(lista, null, 2)` para 0, 1 e vários encontros. | Teste automatizado do escritor |
| CA-04 | Escrita incremental: o temporário cresce durante o processamento, e o arquivo final só aparece ao término. | Teste automatizado |
| CA-05 | Dataset sem encontros (ou só com cabeçalho) gera `[]`. | Teste automatizado |
| CA-06 | Dataset inexistente, inválido ou com falha no meio do processamento: código 1, mensagem clara, nenhum arquivo final criado, arquivo final preexistente intacto e temporário removido. | Teste automatizado |
| CA-07 | Destino impossível de escrever (por exemplo, um diretório): código 1 e mensagem clara. | Teste automatizado |
| CA-08 | CLI completa nos datasets 1 e 2: output idêntico byte a byte aos gabaritos. | Teste automatizado |
| CA-09 | Validador (VAL-02) aceita outputs corretos e rejeita violações de cada regra. | Teste automatizado |
| CA-10 | Sete outputs gerados em `outputs/`, validados (VAL-02), com contagens, tempo e memória registrados. | Execução documentada no plano |
| CA-11 | Datasets 6 e 7: VAL-03 sem divergências. | Execução documentada no plano |

## 7. Decisões

| ID | Questão | Decisão |
| -- | ------- | ------- |
| D1 | Nome padrão do output | `outputs/encontros-<dataset>.json` (ex.: `outputs/encontros-dataset1.json`). |
| D2 | Versionamento dos outputs | Os sete outputs finais (`outputs/encontros-*.json`, 40 kB) são versionados como parte da entrega, marcados como `-text` para preservar os bytes; outros arquivos em `outputs/` são ignorados. |
| D3 | Estratégia padrão | `spatialHash`, conforme o benchmark da spec 003. Substituída por `latitudeSweep` (spec 003, seção 7, D4); os outputs são idênticos byte a byte com as três estratégias. |

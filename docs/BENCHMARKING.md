# Benchmarking e Autotuning

## Benchmark manual

O Benchmark Engine aplica o perfil, reinicia XMRig, aguarda warm-up, coleta telemetria e só compara após amostra mínima.

Medidas usadas quando disponíveis:

- H/s real via API XMRig;
- power com fonte explícita;
- temperatura com fonte explícita;
- accepted/rejected;
- estabilidade do hashrate;
- lucro estimado com tarifa/preço/rede.

## Estatística

Hash passa por mediana/MAD e rejeição de outliers. O resultado armazena estabilidade e confidence score derivado de tempo, amostras, shares, variabilidade, frescor do pool e qualidade da potência.

## Autotune

1. mede baseline;
2. gera candidatos dentro de limites do hardware;
3. Gaussian Process estima regiões promissoras;
4. Expected Improvement escolhe próximo candidato;
5. Safety Engine valida;
6. benchmark mede;
7. candidato precisa superar margem mínima;
8. winner é salvo; loss volta ao melhor conhecido.

## Interrupção

`PARAR OTIMIZAÇÃO` cancela novos experimentos. Em erro/crash/limite térmico, a intenção é restaurar o melhor perfil já conhecido. Last Known Good fica separado em `config.safe.json`.

## Potência estimada

Um benchmark sem wattímetro/sensor ainda pode comparar hashrate/estabilidade, mas **não recebe a mesma confiança econômica** de um teste com potência medida.

# Supreme Mind

Supreme Mind é o motor de otimização do IdeaGold. Não é chatbot e não é deep learning decorativo.

## Componentes reais

- **Rule Engine:** limites térmicos, reject rate, validação de config, auto-recovery.
- **Statistical Model:** mediana/MAD, CV, outlier rejection, intervalo de confiança, estabilidade.
- **Bayesian Optimizer:** Gaussian Process com kernel RBF e Expected Improvement para escolher qual configuração segura medir em seguida.
- **UCB1:** componente disponível para seleção futura entre perfis já bem medidos; não substitui benchmark.
- **Anomaly Detector:** desvios robustos em hash/power/temperatura e rejeições.
- **Profit Engine:** objetivo econômico com custo de energia.

## Modos

- Performance: `maximize(H/s)`.
- Efficiency: `maximize(H/s / W)`.
- Profit: `maximize(revenue - energy - cloudCost)`.
- Balanced: função composta de hash, eficiência, estabilidade e penalidade térmica.
- Silent: reduz impacto/consumo relativo.
- Manual: nenhuma alteração automática.

## Critério de amostra

O Benchmark Engine usa warm-up configurável e amostra mínima. Valores de hash passam por filtro robusto antes da comparação. Uma mudança deve superar margem mínima e Safety Engine para ser mantida.

## Explainable AI

Toda mudança automática registra:

- horário;
- objetivo;
- configuração anterior/nova;
- motivo;
- impacto observado quando calculável;
- confiança;
- resultado WIN/LOSS/ROLLBACK/SAFETY.

## Machine Learning

A V5 **não ativa Transformer, Random Forest ou boosting** sem dataset XMR/RandomX local suficiente. Quando houver histórico, qualquer modelo futuro deverá vencer baseline heurístico/estatístico em validação temporal antes de entrar em produção.

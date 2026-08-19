# Matriz de implementação V5

| Recurso | Inspiração | Estado V5 |
|---|---|---|
| XMRig controller | XMRig | IMPLEMENTADO |
| checksum/supply chain | XMRig / hardening | IMPLEMENTADO |
| CPU fingerprint | RigForge | IMPLEMENTADO |
| config generated/user/safe | RigForge / Pithead | IMPLEMENTADO |
| telemetria 10s/60s/15m | XMRig | IMPLEMENTADO |
| shares/pool balance | MoneroOcean | IMPLEMENTADO |
| ganho real da sessão | requisito IdeaGold | IMPLEMENTADO |
| SQLite histórico | Pithead / arquitetura solicitada | IMPLEMENTADO |
| Market provider fallback | IdeaGold V4 | IMPLEMENTADO |
| energia medida/estimada | Pithead / Efficiency Lab | IMPLEMENTADO |
| Profit Engine + break-even | MineROI-Net (conceito econômico) | IMPLEMENTADO de forma própria |
| Benchmark A/B | RigForge | IMPLEMENTADO |
| outlier/confidence | estatística robusta | IMPLEMENTADO |
| Supreme Mind | requisito + Chimera conceitual | IMPLEMENTADO |
| Bayesian Optimization | requisito | IMPLEMENTADO |
| UCB1 bandit | requisito | IMPLEMENTADO como componente; só deve atuar com perfis suficientes |
| anomaly detection | requisito | IMPLEMENTADO |
| rollback / Last Known Good | RigForge/Pithead | IMPLEMENTADO |
| pool adapters | Pithead | IMPLEMENTADO |
| MoneroOcean | estado atual | IMPLEMENTADO |
| P2Pool local | P2Pool oficial | IMPLEMENTADO opcional |
| P2Pool auto-instalação | — | NÃO: deliberadamente exige instalação/consentimento separado |
| GPU RX460 automática | — | NÃO FINGIDA: somente futura quando backend real passar capability benchmark |
| Deep Learning/Transformer | MineROI-Net | NÃO ATIVADO: dataset local insuficiente |
| sensores CPU package/power | provider local | IMPLEMENTADO quando SO/API local fornece; senão indisponível |
| dashboard premium/basic/advanced | CMO (conceito) | IMPLEMENTADO de forma própria |
| SSE live | requisito | IMPLEMENTADO |
| Scheduler tarifário | requisito opcional/futuro | arquitetura de settings preparada; não anunciado como funcional |
| cloud não autorizada | — | PROIBIDO |

A matriz distingue explicitamente recurso funcional de arquitetura preparada. Nenhum item “não ativado” aparece na UI como se estivesse funcionando.

# Matriz de implementação V5.1

| Recurso | Inspiração | Estado V5.1 |
|---|---|---|
| XMRig controller | XMRig | IMPLEMENTADO |
| checksum/supply chain XMRig | XMRig / hardening | IMPLEMENTADO |
| pré-validação DNS/TLS da pool antes do start | diagnóstico V5.1.1 | IMPLEMENTADO |
| fallback MoneroOcean gulf → sg quando o endpoint principal falha | MoneroOcean oficial | IMPLEMENTADO com probe; sem IP fixo |
| CPU fingerprint | RigForge | IMPLEMENTADO |
| config generated/user/safe | RigForge / Pithead | IMPLEMENTADO |
| telemetria 10s/60s/15m | XMRig | IMPLEMENTADO |
| cache Last Known Good de pool/rede/preço | requisito de estabilidade | IMPLEMENTADO |
| stale shares separado de sourceStale/cache | correção V5.1.1 | IMPLEMENTADO |
| lock contra ticks sobrepostos | requisito de estabilidade | IMPLEMENTADO |
| shares/pool balance | MoneroOcean | IMPLEMENTADO |
| ganho real da sessão | requisito IdeaGold | IMPLEMENTADO |
| baseline pendente quando pool está offline | correção de consistência | IMPLEMENTADO |
| sessão preservada durante auto-recovery | correção de consistência | IMPLEMENTADO |
| SQLite histórico | Pithead / arquitetura solicitada | IMPLEMENTADO |
| regressão SQLite boolean parameter 8 | diagnóstico em hardware real | CORRIGIDA + TESTE AUTOMÁTICO |
| Market provider fallback | IdeaGold V4/V5 | IMPLEMENTADO |
| energia medida/estimada/híbrida | Efficiency Lab + LibreHardwareMonitor | IMPLEMENTADO com fonte explícita |
| Profit Engine + break-even | MineROI-Net (conceito econômico) | IMPLEMENTADO de forma própria |
| Benchmark A/B | RigForge | IMPLEMENTADO |
| outlier/confidence | estatística robusta | IMPLEMENTADO |
| Supreme Mind | requisito + Chimera conceitual | IMPLEMENTADO |
| Bayesian Optimization | requisito | IMPLEMENTADO |
| ML local Ridge Regression | melhoria V5.1 | IMPLEMENTADO; ativa após dataset mínimo real |
| UCB1 bandit | requisito | IMPLEMENTADO como componente; atua apenas com histórico suficiente |
| anomaly detection | requisito | IMPLEMENTADO |
| rollback / Last Known Good | RigForge/Pithead | IMPLEMENTADO |
| Watchdog processo/API/hash | requisito de estabilidade | IMPLEMENTADO, 3 recuperações/15 min + fallback seguro |
| logging estruturado completo | requisito V5.1 | IMPLEMENTADO |
| bundle de diagnóstico sanitizado | requisito V5.1 | IMPLEMENTADO |
| frontend error logging | requisito V5.1 | IMPLEMENTADO |
| pool adapters | Pithead | IMPLEMENTADO |
| MoneroOcean | estado atual | IMPLEMENTADO |
| P2Pool local | P2Pool oficial | IMPLEMENTADO opcional |
| P2Pool instalação assistida | P2Pool oficial | IMPLEMENTADO com consentimento + SHA-256 da lista oficial; não abre firewall |
| P2Pool start/stop local | P2Pool oficial | IMPLEMENTADO quando monerod RPC/ZMQ local está pronto |
| GPU AMD/OpenCL capability probe | XMRig OpenCL | IMPLEMENTADO |
| GPU A/B CPU × OpenCL | requisito RX 460 | IMPLEMENTADO com rollback; só mantém GPU se medição superar baseline |
| sensores CPU/GPU | LibreHardwareMonitor | IMPLEMENTADO via WMI/REST local + fallback ACPI |
| instalação LibreHardwareMonitor | Winget/consentimento explícito | IMPLEMENTADO |
| wall power | wattímetro do usuário | IMPLEMENTADO quando informado; sensores de componente não são falsamente chamados de tomada |
| dashboard basic/advanced | CMO (conceito) | IMPLEMENTADO de forma própria |
| SSE live | requisito | IMPLEMENTADO |
| Scheduler tarifário/horário | requisito | IMPLEMENTADO; desligado por padrão |
| Profit Guard agendado | requisito | IMPLEMENTADO opcional: pausa abaixo de lucro mínimo configurado |
| cloud/workers autorizados | IdeaGold | IMPLEMENTADO via HMAC + SQLite |
| cloud não autorizada/cryptojacking | — | PROIBIDO POR SEGURANÇA, não é uma pendência |

## Sobre Deep Learning / Transformer

A V5 marcava Transformer como não ativado porque não existia dataset local suficiente. A V5.1 fecha a necessidade de "ML real" sem fingir Deep Learning: implementa **Ridge Regression local** sobre benchmarks reais da máquina e só habilita suas recomendações após um número mínimo de configurações únicas. O Bayesian Optimizer continua como motor principal de exploração segura. Um Transformer seria tecnicamente desproporcional ao volume de dados deste caso e não é apresentado como melhoria só por marketing.

## Regra de realidade

Nenhum recurso condicionado ao hardware aparece como sucesso antes do teste real. Exemplos:

- OpenCL detectado não significa GPU lucrativa; o A/B precisa vencer o CPU-only;
- LibreHardwareMonitor pode fornecer potência de componentes, mas somente wattímetro/sensor explícito é chamado de potência medida na tomada;
- P2Pool instalado não significa pronto para mineração sem `monerod` RPC 18081 + ZMQ 18083;
- ML local não decide antes do dataset mínimo;
- pool só é considerada utilizável no start depois de DNS/TLS real; se nenhum endpoint funcionar, o usuário recebe erro em vez de estado falso de mineração.

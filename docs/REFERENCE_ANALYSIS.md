# Análise dos repositórios de referência

A implementação V5 foi escrita de forma própria. Referências externas foram usadas para arquitetura/documentação e não como blocos copiados sem auditoria de licença.

| Projeto | Arquitetura/uso observado | Licença observada | Uso no IdeaGold | Risco/decisão |
|---|---|---|---|---|
| `xmrig/xmrig` | minerador C/C++, RandomX, API HTTP, Huge Pages/MSR, benchmark | GPL-3.0 | **Integração externa principal**; IdeaGold controla o binário oficial | Não reinventar RandomX. Release é verificada antes de executar. |
| `p2pool-starter-stack/rigforge` | provisionamento/tuning de XMRig orientado ao hardware e testes comparativos | MIT no repositório auditado | **Inspiração conceitual** para fingerprint, benchmark A/B e configuração vencedora | Não copiar shell específico; V5 reimplementa em Node. |
| `p2pool-starter-stack/pithead` | stack Monero/P2Pool, workers, health/failover/dashboard | LICENSE do código próprio: MIT; terceiros retêm licenças próprias | **Inspiração conceitual** para adapters, health, histórico e P2Pool opcional | Componentes GPL externos não são relicenciados pelo IdeaGold. |
| `NeuroKoder3/crypto-miner-optimizer` | React/Vite UI, páginas de profiles/benchmark/health/profitability e alegações de AI | MIT | **Somente conceitos de UX** | README anuncia deep learning, mas alegação não é adotada como prova. V5 não chama heurística de deep learning. |
| `AMAAI-Lab/MineROI-Net` | PyTorch, janelas 30/60 dias, FFT/channel mixing/Transformer para ROI de compra de ASIC Bitcoin | licença não detectada na auditoria | **Conceito econômico/time-series apenas** | Problema alvo é diferente de RandomX CPU; Transformer não é usado sem dataset XMR suficiente. |
| `deskiziarecords/chimera` | workspace Rust modular com crates core/intelligence/dashboard/scheduler/state | licença não detectada na auditoria | **Inspiração arquitetural** para módulos independentes e engine de decisão | Nenhum código copiado. |
| `raystanza/OxideMiner` | caminho solicitado não foi resolvido pelo GitHub durante a auditoria | indisponível | **Nenhuma reutilização** | Não inventar arquitetura/licença de repositório que não pôde ser recuperado. |
| `Tritonn204/tnn-miner` | minerador C; descrição atual é Astrobwtv3/DERO, não referência Monero/RandomX primária | MIT | **Referência geral de miner architecture apenas** | Não usado como base RandomX, pois a premissa do prompt não coincide com o estado atual do repo. |
| `SChernykh/p2pool` | pool descentralizado Monero, main/mini/nano, PPLNS, Stratum local | GPL-3.0 | **Adapter opcional**; execução externa/local | P2Pool não é obrigatório; V5 não copia seu código GPL. |

## Decisões técnicas resultantes

1. XMRig continua sendo o único motor RandomX principal da V5.
2. Supreme Mind otimiza **configurações do XMRig**, não o algoritmo PoW.
3. Bayesian Optimization foi implementada de forma independente, com Gaussian Process/RBF + Expected Improvement, porque o espaço é pequeno e discreto e isso reduz testes agressivos.
4. Transformer/Random Forest/Gradient Boosting não são ativados até haver histórico suficiente e uma validação temporal que demonstre vantagem sobre regras/estatística simples.
5. P2Pool é modular e opcional.
6. GPU permanece modular; a V5 não finge que RX 460 está minerando quando não existe backend/telemetria confirmada.

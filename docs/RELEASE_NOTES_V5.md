# IdeaGold 5.0 — Mining Intelligence

## Escopo

Remodelação estrutural do IdeaGold preservando o caminho de mineração controlada pelo usuário e substituindo o monólito anterior por módulos auditáveis.

## Entregas principais

- backend local modular;
- frontend responsivo Basic/Advanced;
- XMRig Controller com origem oficial, checksum e API local;
- telemetria real separando hash 10s/60s/15m, pool e sessão;
- armazenamento local SQLite/fallback compatível do runtime;
- sessões, benchmarks, perfis, decisões, alerts e histórico;
- Profit Engine com energia, break-even e what-if;
- adapters MoneroOcean e P2Pool opcional;
- Market Provider com fallback e timestamp;
- Power Providers distinguindo estimado e medido;
- Benchmark Engine A/B;
- Supreme Mind com Rule Engine, Statistical Model e Bayesian Optimizer;
- UCB1 disponível para seleção de perfis quando houver dados suficientes;
- anomaly detection, watchdog, auto-recovery limitado e rollback;
- Last Known Good Configuration;
- Decision Log explicável;
- SSE para dados ao vivo;
- documentação de arquitetura, segurança, benchmark, pools, instalação e licenças;
- CI Windows + Node 26.

## Limites mantidos explícitos

- nenhuma promessa de lucro;
- nenhuma métrica falsa;
- nenhuma mineração oculta;
- nenhuma desativação furtiva de proteção;
- nenhuma chave privada/seed;
- temperatura e watts só são chamados de reais quando existe provider real;
- ML/deep learning não é ativado sem dataset/modelo validado;
- GPU permanece modular e não é contabilizada como minerando sem backend/telemetria comprovados.

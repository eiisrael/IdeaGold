# IdeaGold 5.0 — Mining Intelligence Platform

IdeaGold 5.0 é uma plataforma **local-first** para mineração autorizada de Monero/XMR com RandomX. O motor de mineração continua sendo o **XMRig oficial**, enquanto o IdeaGold controla processo/configuração, mede telemetria real, registra histórico em SQLite, calcula energia/rentabilidade e executa autotuning controlado pelo **Supreme Mind**.

## Regra central

- dado ausente não vira zero fictício;
- estimativa é rotulada como estimativa;
- ganho real da sessão vem da diferença observada no pool;
- preço vem de APIs reais com fallback/cache curto;
- potência mostra a fonte: sensor/medida pelo usuário/estimada;
- Supreme Mind nunca é apresentado como deep learning: hoje ele combina Rule Engine, Statistical Model e Bayesian Optimizer; ML avançado permanece desligado até existir dataset local suficiente;
- nenhuma mineração escondida, persistência furtiva, desativação de antivírus ou uso de máquina não autorizada.

## Início rápido no Windows

1. Baixe/clone a branch da versão 5.
2. Dê dois cliques em `INICIAR_IDEAGOLD.bat`.
3. O Windows solicitará Administrador explicitamente para Huge Pages/MSR.
4. O launcher valida sintaxe e executa os testes antes de abrir o painel.
5. Abra `http://127.0.0.1:8080`.
6. Cole **somente o endereço público XMR** e clique **INICIAR MINERAÇÃO**.

Requisito: Node.js **22.5+**. Node 26 é suportado.

## Arquitetura

```text
frontend/
  index.html, styles.css, app.js
backend/
  server.js, settings.js
miner/
  xmrig-controller.js, config-manager.js
telemetry/
  engine.js
providers/
  hardware/, power/, market/, pool/
optimizer/
  supreme-mind.js, benchmark-engine.js, bayesian-optimizer.js,
  statistics.js, safety-engine.js, anomaly-detector.js, scoring.js
  bandit.js, profit-engine.js
database/
  db.js
scripts/
  check.js
tests/
  run.js
docs/
  documentação técnica
```

## O que é real

### Mineração
- XMRig oficial 6.26.0 no Windows x64, fixado por release e SHA-256.
- RandomX CPU como caminho padrão estável.
- API do XMRig em `127.0.0.1:18080`.
- Start/stop/restart/pause-resume controlados pelo usuário.
- Huge Pages/MSR solicitados no config, sem desativar proteções do Windows.

### Telemetria
- H/s 10s, 60s e 15m separados.
- accepted/rejected da sessão.
- hash efetivo e saldo do pool quando o adapter fornece.
- ganho real = `(saldo devido + pago atual) - baseline da sessão`.
- SQLite guarda sessões, telemetria, benchmarks, decisões, alertas e snapshots.

### Rentabilidade
- preço XMR: CoinGecko → CryptoCompare → Kraken + Frankfurter → cache recente.
- dificuldade/reward via adapter de rede.
- custo/hora/dia/mês, XMR/kWh, H/W e break-even.
- projeção teórica separada do crédito real do pool.
- ETA de share e incremento usa distribuição probabilística; nunca é promessa de horário exato.

### Supreme Mind
Objetivos disponíveis:

- `performance`: maximiza H/s;
- `efficiency`: maximiza H/W;
- `profit`: maximiza líquido estimado;
- `balanced`: pondera hash/eficiência/estabilidade/térmico;
- `silent`: reduz impacto;
- `manual`: não altera configuração automaticamente.

Autotuning:

```text
baseline
→ warm-up
→ amostragem
→ limpeza de outliers
→ candidato seguro
→ comparação estatística
→ winner ou rollback
→ Last Known Good
```

O espaço de busca é sugerido por um Gaussian Process com Expected Improvement. A política UCB1 existe para futura seleção entre perfis com histórico suficiente; não é usada para inventar performance.

## Pools

- **MoneroOcean**: adapter principal desta versão.
- **P2Pool**: opção avançada/local. Detecta Stratum local; métricas detalhadas só aparecem quando `P2POOL_DATA_API` está configurado.
- P2Pool não é obrigatório e o IdeaGold não inventa dados se o node não estiver disponível.

## Energia e sensores

Prioridade de fonte:

1. sensor local configurado em `IDEAGOLD_SENSOR_URL` → `W reais`;
2. wattímetro informado pelo usuário → `W reais`;
3. modelo do perfil → `W estimados`.

Temperatura também permanece `indisponível` quando o Windows/hardware não fornece sensor confiável. Uma zona ACPI pode ser mostrada com ressalva explícita; não é rebatizada como CPU Package.

## Segurança

- backend em localhost por padrão;
- endpoints de alteração exigem origem loopback;
- XMRig HTTP API em localhost;
- somente endereço público XMR é necessário;
- seed phrase/private spend key nunca são solicitadas;
- binário automático do XMRig tem checksum fixado antes de executar;
- auto-recovery limitado a 3 tentativas/15 min;
- config gerado, config do usuário e Last Known Good são separados e recebem backup lógico.

Consulte `docs/SECURITY.md`.

## Validação

```bash
npm run check
npm test
```

Os testes cobrem estatística, ETA probabilística, energia, break-even, configuração, Safety Engine, pool score, Bayesian Optimizer e persistência SQLite.

## Limites reais

O IdeaGold pode reduzir desperdício e encontrar melhor configuração **para o hardware medido**, mas não muda a matemática do PoW nem cria hashrate/energia gratuitos. Se a tarifa for maior do que a receita, o painel exibirá prejuízo estimado; o modo Profit pode concluir que um perfil menos agressivo é melhor, mas não promete tornar hardware antigo lucrativo.

Documentação adicional:

- `docs/AUDIT.md`
- `docs/REFERENCE_ANALYSIS.md`
- `docs/IMPLEMENTATION_MATRIX.md`
- `docs/ARCHITECTURE.md`
- `docs/SUPREME_MIND.md`
- `docs/SECURITY.md`
- `docs/INSTALL_WINDOWS.md`
- `docs/INSTALL_LINUX.md`
- `docs/POOL_ADAPTERS.md`
- `docs/BENCHMARKING.md`
- `THIRD_PARTY_LICENSES.md`
- `ATTRIBUTIONS.md`

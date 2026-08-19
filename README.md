# IdeaGold 5.1 — Mining Intelligence Platform

IdeaGold 5.1 é uma plataforma **local-first** para mineração autorizada de Monero/XMR. O motor de mineração continua sendo o **XMRig oficial**; o IdeaGold controla processo/configuração, observa telemetria, preserva histórico em SQLite, mede/estima energia de forma rotulada, calcula rentabilidade e executa benchmarks/autotuning com rollback.

## Regra central

- dado ausente não vira zero fictício;
- falha temporária de API não apaga imediatamente o último valor válido: o painel mostra **cache + idade**;
- estimativa é rotulada como estimativa;
- ganho real da sessão vem da diferença observada no pool;
- sessão não é encerrada só porque o XMRig caiu durante auto-recovery;
- baseline de saldo fica pendente se o pool estiver offline no início, evitando contar saldo antigo como ganho da sessão;
- potência na tomada só é chamada de medida quando vem de wattímetro/sensor explicitamente configurado;
- Supreme Mind não inventa Deep Learning: usa regras + estatística + Bayesian Optimization e, após dataset mínimo, Ridge Regression local treinada nos benchmarks reais do hardware;
- nenhuma mineração escondida, persistência furtiva, desativação de antivírus ou uso de máquina não autorizada.

## Início rápido no Windows

1. Execute `INICIAR_IDEAGOLD.bat`.
2. Aceite UAC quando quiser Huge Pages/MSR e sensores que exigem privilégio.
3. Abra `http://127.0.0.1:8080`.
4. Informe **somente o endereço público XMR**.
5. Clique em **INICIAR MINERAÇÃO**.

Requisito: Node.js **22.5+**. O CI valida Node 26 no Windows.

## V5.1: estabilidade e diagnóstico

A V5.1 foi criada para resolver dois sintomas de campo: métricas que apareciam/sumiam em falhas transitórias e XMRig que podia encerrar sem causa claramente visível.

### Telemetria resiliente

- lock impede `tick()` sobreposto;
- pool: último valor válido pode ser preservado por até 10 minutos, sempre marcado como cache/stale;
- network stats: até 15 minutos;
- preço XMR: até 30 minutos;
- recuperação da fonte gera evento/log;
- confiança da taxa é reduzida quando a fonte está em cache;
- valor nunca é rotulado como ao vivo quando não é.

### Watchdog de processo + API/hash

O watchdog diferencia:

- processo XMRig encerrou inesperadamente;
- processo existe, mas API/hash ficaram travados por tempo prolongado;
- parada manual;
- pausa manual/scheduler/térmica;
- benchmark/autotuning controlado.

Auto-recovery continua limitado a **3 recuperações em 15 minutos**. Na terceira tentativa um perfil conservador pode reduzir um thread, desligar GPU e usar `yield`/prioridade segura. Depois do limite o sistema para de insistir e registra alerta em vez de criar loop infinito.

### Observabilidade

`runtime/logs/ideagold.jsonl` recebe logs JSONL estruturados e rotacionados com:

- backend/startup;
- chamadas HTTP locais;
- XMRig start/stop/restart/exit/API;
- pool/rede/preço failure/recovery;
- telemetria/state changes;
- watchdog;
- benchmark;
- Supreme Mind/decisões;
- GPU Tuner;
- sensores;
- P2Pool;
- Scheduler;
- workers;
- erros do frontend.

Na página **Logs** existem System Log, XMRig Log, Config Audit, P2Pool Log, All Logs e **Exportar Diagnóstico**. O bundle sanitiza segredos e mascara endereço de carteira.

## GPU AMD/OpenCL

A GPU deixou de ser um botão decorativo. A V5.1 possui:

1. `probeOpenCL()` do próprio XMRig;
2. detecção explícita de backend AMD/OpenCL;
3. benchmark A/B `CPU-only` × `CPU + OpenCL`;
4. warm-up e amostragem real;
5. regras de segurança;
6. rollback automático;
7. persistência do GPU somente quando o candidato supera o baseline no objetivo escolhido.

Para `profit` e `efficiency`, a decisão automática exige wattímetro ou telemetria de potência melhor que simples estimativa de perfil. Detectar OpenCL **não significa** que uma GPU será rentável.

## Sensores e energia

A V5.1 integra **LibreHardwareMonitor** local por:

- WMI `root\\LibreHardwareMonitor`;
- fallback REST local `127.0.0.1:8085`;
- instalação explícita via Winget pelo botão da UI;
- fallback ACPI quando não existe CPU Package confiável.

Prioridade de potência econômica:

1. wattímetro informado pelo usuário → `measured / wall`;
2. sensor local explicitamente configurado → `measured / sensor-reported`;
3. LibreHardwareMonitor CPU/GPU power + base do sistema → `hybrid`, nunca chamado de watt na tomada;
4. perfil do hardware → `estimated`.

Temperatura e potência permanecem `indisponível` quando nenhuma fonte confiável existe.

## Scheduler / Profit Guard

O Scheduler agora é funcional e **desligado por padrão**. Quando ativado pelo usuário pode:

- minerar apenas numa janela diária;
- lidar com janela que atravessa meia-noite;
- pausar quando o lucro líquido estimado fica abaixo de um limite escolhido;
- retomar somente quando foi o próprio Scheduler que pausou a mineração.

Parada manual do usuário cancela a intenção de auto-resume.

## P2Pool

Além do adapter existente, a V5.1 inclui um gerenciador local explícito:

- consulta a release oficial atual;
- escolhe pacote Windows x64;
- exige `sha256sums.txt.asc` na release;
- compara SHA-256 do arquivo antes de extrair;
- não abre firewall/UPnP automaticamente;
- pode iniciar/parar P2Pool local quando `monerod` já está pronto em RPC 18081 + ZMQ 18083;
- expõe Stratum apenas em `127.0.0.1:3333` pelo gerenciador padrão.

O checksum é conferido contra a lista da release oficial. A assinatura GPG da lista não é anunciada como independentemente verificada pelo IdeaGold.

## Supreme Mind + ML local

Objetivos:

- `performance`: H/s;
- `efficiency`: H/W;
- `profit`: líquido estimado;
- `balanced`: hash + eficiência + estabilidade + térmico;
- `silent`: menor impacto;
- `manual`: sem alterações automáticas.

Pipeline:

```text
baseline
→ warm-up
→ amostragem
→ outliers
→ Safety Engine
→ Bayesian Optimizer
→ ML local quando dataset >= mínimo
→ comparação
→ winner ou rollback
→ Last Known Good
```

A Ridge Regression local só ativa depois de pelo menos 8 configurações únicas medidas. Antes disso, o painel mostra **coletando dados**.

## Workers LAN/VPS/cloud autorizados

`worker-agent.js` continua funcional com HMAC-SHA256, timestamp, replay protection, SQLite e expiração de worker. Não existe shell remoto nem instalação furtiva. Para uso em um único PC mantenha `HOST=127.0.0.1`.

## Arquitetura

```text
frontend/       UI Basic/Advanced + v51 stability layer
backend/        HTTP/SSE, settings, worker auth
miner/          XMRig controller + config manager
telemetry/      resilient telemetry engine
providers/      hardware, power, market, pool/P2Pool
optimizer/      Supreme Mind, GPU Tuner, Scheduler, Bayesian, ML, Safety
observability/  structured logger + diagnostic bundle
database/       SQLite
workers/        worker-agent.js
tests/          unit, workers, runtime safety, smoke
```

## Segurança

- localhost por padrão;
- APIs administrativas e diagnóstico exigem loopback;
- heartbeat remoto é a exceção autenticada por HMAC;
- XMRig API em localhost;
- somente endereço público XMR é necessário;
- seed/private keys nunca são solicitadas;
- XMRig automático usa checksum fixado;
- P2Pool não é executado antes da verificação de checksum;
- nenhum componente abre firewall ou tenta burlar antivírus;
- decisão automática usa rollback e Last Known Good.

## Validação

```bash
npm ci
npm run check
npm test
npm run test:smoke
```

Os testes cobrem matemática, ETA, energia, config segura, Scheduler, ML local, sensores, Bayesian Optimization, SQLite, workers HMAC, watchdog/rollback e o smoke real do backend/diagnóstico.

## Limites reais

IdeaGold pode reduzir desperdício e encontrar uma configuração melhor **para o hardware medido**, mas não altera a matemática do Proof-of-Work nem garante lucro. Resultado financeiro continua dependente de hashrate, eficiência, tarifa, preço, dificuldade e pool.

Veja também:

- `docs/IMPLEMENTATION_MATRIX.md`
- `docs/AUDIT.md`
- `docs/STABILITY_V51.md`
- `docs/SUPREME_MIND.md`
- `docs/SECURITY.md`
- `docs/POOL_ADAPTERS.md`
- `docs/BENCHMARKING.md`

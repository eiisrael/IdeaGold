# IdeaGold 5.1 — Stability & Observability

## Sintomas que originaram a V5.1

Em uso real foram observados dois sintomas:

1. valores de pool/preço/hash apareciam e depois voltavam para `—`;
2. o XMRig podia ficar parado sem a interface explicar claramente por quê.

## Causa 1 — contrato SSE incorreto

A revisão encontrou uma causa direta para o efeito visual “aparece → some → aparece”. O backend V5.0 emitia no evento SSE `telemetry` o objeto de **status inteiro**, mas o frontend tratava o payload como se fosse apenas a **amostra de telemetria** e o colocava em `state.status.telemetry`.

Isso produzia uma estrutura aninhada temporariamente no lugar errado. O render ao vivo podia então procurar `hash10s`, `pool`, `market` etc. no nível incorreto e mostrar `—`. No refresh HTTP seguinte, `/api/status` reconstruía a estrutura correta e os valores reapareciam.

### Correção

A V5.1 possui um contrato explícito em `backend/contracts.js`:

- evento `telemetry` envia **somente a amostra de telemetria**;
- `/api/status` continua enviando o status completo;
- teste automatizado rejeita payload SSE com propriedade `telemetry` aninhada.

## Causa 2 — falhas transitórias apagavam a última leitura válida

Na V5.0, uma consulta temporariamente malsucedida podia substituir imediatamente o último objeto válido da fonte por `{available:false}`. Isso fazia a UI apagar dados que haviam sido válidos segundos antes.

### Correção

Cada fonte lenta agora possui um slot com:

- último valor válido;
- horário do último sucesso;
- horário da última tentativa;
- último erro;
- número de falhas consecutivas.

Janelas de retenção:

- pool: 10 min;
- network: 15 min;
- market: 30 min.

Valor retido recebe `cached/sourceStale/staleSec/sourceError`. Não é chamado de ao vivo. O campo `stale` permanece reservado à contagem de stale shares fornecida pelo pool. O crescimento observado do pool só adiciona **um ponto por refresh real**, evitando que um mesmo snapshot em cache aumente artificialmente a confiança da ETA.

## Hotfix V5.1.1 — erro SQLite encontrado em máquina real

O bundle de diagnóstico de 19/08/2026 revelou uma colisão de tipos que os testes anteriores não reproduziam: o cache de fonte reutilizava o nome `stale` como booleano, mas `pool_snapshots.stale` é uma coluna INTEGER destinada à contagem de stale shares. No Node 26, o SQLite embutido rejeitou `true/false` com:

`Provided value cannot be bound to SQLite parameter 8.`

Consequências observadas:

- o Telemetry Engine abortava o tick antes de publicar uma nova amostra;
- o frontend permanecia em `INICIALIZANDO`/`OFF` mesmo depois de `POST /api/miner/start -> 200`;
- Benchmark/Supreme Mind também falhavam porque dependem de uma amostra válida;
- parecia que o botão de mineração não funcionava.

Correção V5.1.1:

- `stale` voltou a significar exclusivamente **número de stale shares**;
- estado do cache usa `sourceStale` + `cached` + `staleSec`;
- foram adicionados testes de regressão que persistem snapshots reais no SQLite.

## Hotfix V5.1.1 — pré-validação da pool

O mesmo diagnóstico mostrou o XMRig repetindo:

`gulf.moneroocean.stream:20128 DNS error: "unknown node or service"`

Antes de spawnar o XMRig, o IdeaGold agora testa DNS + TLS da pool. Para MoneroOcean ele tenta primeiro `gulf.moneroocean.stream` e, se o endpoint principal não resolver/conectar, tenta o endpoint oficial alternativo `sg.moneroocean.stream`. Nenhum IP é fixado e nenhum DNS de segurança é contornado.

Se nenhum endpoint estiver acessível, o start retorna erro explícito à interface em vez de mostrar “Minerador iniciado” enquanto o XMRig fica sem pool.

## Causa 3 — ticks sobrepostos

Chamadas de PowerShell e APIs podem demorar mais do que o intervalo normal do loop. A V5.1 impede um segundo `tick()` enquanto o anterior estiver em execução.

## Causa 4 — encerramento inesperado do XMRig

O Controller agora registra:

- motivo de start/restart/stop/pause;
- PID;
- exit code;
- exit signal;
- uptime antes do exit;
- `desired state`;
- trecho final do log XMRig;
- falha/recovery da API local.

`pause-on-battery` deixou de ser opt-out e passou a ser **opt-in**. O valor padrão é `false`. Na primeira execução da V5.1, configurações V5 antigas são migradas com `pauseOnBattery=false` e Scheduler desativado para que um comportamento legado não cause parada automática inesperada.

## Watchdog V5.1

O watchdog trata dois tipos de falha:

### Process exit

`desired=running` e PID não está mais vivo.

### API/hash hang

Processo está vivo, passou do período inicial, mas API XMRig ou hash 10s/60s permanecem ausentes por período prolongado.

### Recovery policy

- máximo 3 tentativas em 15 min;
- cada tentativa entra em Decision Log + structured log;
- terceira tentativa aplica Safe Fallback: um thread a menos, GPU off, yield on, prioridade <= 3;
- atingido o limite, não entra em loop infinito.

## Sessão

Auto-recovery não finaliza a sessão. Sessão só é finalizada por estado explicitamente parado.

Se o pool estiver indisponível quando a sessão começa, o baseline fica `pending`. O primeiro snapshot real do pool estabelece o baseline, evitando contar saldo antigo como ganho da sessão.

## Logs

Arquivo principal:

`runtime/logs/ideagold.jsonl`

Formato JSONL rotacionado. Componentes principais:

- backend
- http
- frontend
- xmrig
- telemetry
- session
- anomaly
- watchdog
- benchmark
- supreme
- gpu
- sensors
- p2pool
- scheduler
- worker

## Diagnóstico

`GET /api/diagnostics` é local-only e gera um bundle sanitizado contendo:

- versão/Node/OS;
- hardware fingerprint;
- settings com carteira mascarada;
- estado XMRig;
- telemetria atual;
- Supreme Mind / Benchmark / GPU / Scheduler / Workers;
- alerts e decisões;
- structured logs recentes;
- tails de XMRig/config/P2Pool.

Secrets, passwords, tokens, seed/private keys são redigidos pelo logger.

## Procedimento para investigar uma nova parada

1. Não reinicie manualmente de imediato se quiser capturar a causa.
2. Abra `Logs`.
3. Veja `System Log` e `XMRig Log`.
4. Clique `EXPORTAR DIAGNÓSTICO`.
5. O arquivo pode ser analisado sem expor seed/private keys.

## GPU

GPU é opt-in/benchmark-driven. O GPU Tuner executa:

`probe → CPU baseline → OpenCL candidate → safety → objective comparison → winner/rollback`

Nenhum ganho é presumido pela simples existência de AMD/OpenCL.

## Sensores

LibreHardwareMonitor pode ser detectado via WMI ou REST local. Potência de componentes é marcada como `hybrid`, não como wall power.

## Scheduler

Scheduler é desligado por padrão e funciona como **pausa/retomada**, não como início inesperado de mineração. Só uma ação explícita do usuário habilita pausas por horário/lucro. Apenas pausas iniciadas pelo Scheduler podem ser retomadas automaticamente por ele; ao desativar o Scheduler, uma pausa causada por ele é devolvida ao controle manual.

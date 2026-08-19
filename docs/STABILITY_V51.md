# IdeaGold 5.1 — Stability & Observability

## Sintomas que originaram a V5.1

Em uso real foram observados dois sintomas:

1. valores de pool/preço apareciam e depois voltavam para `—`;
2. o XMRig podia ficar parado sem a interface explicar claramente por quê.

## Causa 1 — valores desaparecendo

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

Valor retido recebe `cached/stale/staleSec/sourceError`. Não é chamado de ao vivo.

## Causa 2 — ticks sobrepostos

Chamadas de PowerShell e APIs podem demorar mais do que o intervalo normal do loop. A V5.1 impede um segundo `tick()` enquanto o anterior estiver em execução.

## Causa 3 — encerramento inesperado do XMRig

O Controller agora registra:

- motivo de start/restart/stop/pause;
- PID;
- exit code;
- exit signal;
- uptime antes do exit;
- `desired state`;
- trecho final do log XMRig;
- falha/recovery da API local.

`pause-on-battery` deixou de ser opt-out e passou a ser **opt-in**. O valor padrão é `false`.

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

Nenhum ganho é presumido pela simples existência da RX/AMD/OpenCL.

## Sensores

LibreHardwareMonitor pode ser detectado via WMI ou REST local. Potência de componentes é marcada como `hybrid`, não como wall power.

## Scheduler

Scheduler é desligado por padrão. Só uma ação explícita do usuário permite pausas por horário/lucro. Apenas pausas iniciadas pelo Scheduler podem ser retomadas automaticamente por ele.

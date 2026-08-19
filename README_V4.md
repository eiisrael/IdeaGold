# IdeaGold 4.1 — GoldBrain Real

A V4.1 corrige a telemetria e a estimativa da V4 para que o painel diferencie processo aberto, calibracao e mineracao efetiva. Nenhum cronometro ou lucro e apresentado como real quando faltam dados suficientes.

## Correcoes principais

- Estado real do minerador: `parado`, `iniciando`, `calibrando`, `minerando`, `confirmado pelo pool` ou `travado`.
- O painel so mostra **minerando** quando existe hashrate local real ou trabalho recente confirmado pelo pool.
- Shares antigas do pool nao sao mais apresentadas como shares da sessao atual. Ao iniciar, o IdeaGold grava um baseline do pool e mostra apenas a diferenca desta sessao.
- O saldo ganho na sessao e calculado por `amtDue + amtPaid` atual menos o baseline registrado ao iniciar.
- Hashrate efetivo prioriza `hash2`, o hashrate XMR-normalizado do MoneroOcean, e ignora dado do pool quando a ultima share esta velha.
- A API local do XMRig e reforcada na inicializacao em `127.0.0.1:18080`; se ela falhar, o IdeaGold pode extrair telemetria recente do log da sessao.
- O preco do XMR usa fontes reais com fallback e cache curto. Sem preco valido, o painel mostra `aguardando preco` em vez de calcular BRL ficticio.
- Projecoes de lucro so sao exibidas quando ha uma taxa de producao observavel e preco real disponivel.
- Consumo aparece como **medido** quando informado por wattimetro; caso contrario aparece explicitamente como **estimativa do perfil de hardware**.

## Proximo incremento dinamico

O antigo marco fixo de `0.000015 XMR` foi removido da tela principal. A V4.1 escolhe o proximo incremento usando dados da sessao:

1. quando ja existem creditos positivos reais do pool, usa a mediana dos incrementos observados;
2. durante o bootstrap, usa um quantum dinamico derivado da taxa de producao disponivel;
3. se ainda nao existe taxa confiavel, mostra **AGUARDANDO DADOS** e nao inventa `00:00:00`.

A ETA e calculada por:

```text
tempo esperado = XMR restante / taxa XMR por segundo
```

A faixa otimista/conservadora e derivada da variabilidade observada. Como o MoneroOcean usa PPLNS, o credito pode aparecer em blocos em vez de pingar a cada segundo; por isso a ETA representa producao equivalente, nao promessa de horario de pagamento.

## Minerador e desempenho

### Modo Estavel — padrao

Usa XMRig oficial 6.26.0 verificado por SHA-256, RandomX e configuracao segura para iniciar a mineracao imediatamente. Huge Pages, MSR, ASM e ajuste de threads continuam habilitados.

### Modo Auto-switch avancado — opcional

Usa o build avancado do MoneroOcean 6.26.0-mo4, fixado em commit e verificado antes de executar. Os resultados de benchmark podem ser salvos para evitar calibracoes completas em cada inicio. Enquanto o minerador estiver benchmarkando, a interface mostra **CALIBRANDO**, nao **MINERANDO**.

GPU AMD/OpenCL continua opcional. No modo automatico ela so e considerada ativa quando a telemetria confirma backend OpenCL real.

## Estimador GoldBrain

O estimador combina somente sinais existentes:

- crescimento real do saldo do pool;
- hashrate XMR-normalizado recente do pool;
- modelo de rede local quando o algoritmo permite comparacao valida.

Cada fonte recebe peso de confianca. Sem fonte suficiente, a taxa fica indisponivel em vez de virar zero apresentado como previsao.

## Workers autorizados

O suporte a PC/LAN/VPS/cloud permanece. Workers usam heartbeat HMAC e podem informar potencia, tarifa e custo cloud. O IdeaGold nao cria nem usa maquinas de terceiros sem autorizacao.

## Validacao

```bash
npm run check
npm test
```

A V4.1 inclui testes para ETA dinamica, regressao de saldo, estimador hibrido e ausencia segura de previsao quando faltam dados.

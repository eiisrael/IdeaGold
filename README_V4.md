# IdeaGold 4.0 — GoldBrain

A V4 mantém a experiência de um clique, mas troca o estimador simples por um motor híbrido e melhora a configuração do minerador.

## O que mudou

- MoneroOcean advanced XMRig `6.26.0-mo4` fixado no commit `13b87c26...` e verificado pelo Git blob SHA-1 antes de executar.
- Fallback para XMRig oficial `6.26.0` com SHA-256 fixado.
- Remove o sufixo `~rx/0` do password no build avançado, permitindo que o minerador/pool usem o mecanismo de algoritmo mais rentável quando suportado.
- CPU em RandomX com `mode=fast`, Huge Pages, Huge Pages JIT, MSR, ASM automático, `yield=false`, prioridade 3 e seleção automática de threads por cache/algoritmo.
- OpenCL habilitável/automático para AMD; CUDA permanece desligado neste perfil.
- Watchdog reinicia o minerador quando ele fecha inesperadamente, mas respeita o botão PARAR.
- Workers HMAC para outro PC/VPS autorizado, com custo de energia e custo cloud incorporados ao lucro líquido.
- O painel usa o hashrate normalizado do MoneroOcean quando disponível, evitando comparar diretamente H/s de algoritmos incompatíveis.

## GoldBrain Hybrid Estimator

O SupremeMind usa busca híbrida ponderada. A V4 reutiliza esse princípio de engenharia, não o código de busca: várias fontes independentes recebem pesos de confiança e são combinadas.

Sinais do estimador:

1. **Saldo real do pool** — regressão ponderada do total ganho (`amtDue + amtPaid`) ao longo do tempo. Peso máximo 55%.
2. **Hashrate XMR-normalizado do pool** — convertido por dificuldade e recompensa atuais. Peso máximo 35%.
3. **Modelo de rede local** — usado como bootstrap quando o algoritmo local é RandomX. Peso máximo 10%.

Os pesos são renormalizados conforme os sinais existem e a confiança do histórico aumenta.

### Taxa esperada

Para RandomX:

```text
XMR/s = H/s / dificuldade × recompensa × fator do minerador
```

### Próximo marco

O painel usa um marco padrão de `0.000015 XMR` e calcula:

```text
tempo esperado = XMR restante / XMR por segundo estimado
```

Também exibe faixa otimista/conservadora baseada na variabilidade robusta do hashrate. Isso é uma **ETA estatística**, não um relógio garantido, porque shares são aleatórias.

### Próxima share

Quando a dificuldade da share está disponível:

```text
E[T] = dificuldade_da_share / hashrate
mediana = ln(2) × E[T]
p80 = -ln(0.2) × E[T]
```

### Lucro

```text
bruto XMR = taxa XMR/s × segundos
bruto BRL = bruto XMR × preço XMR/BRL
energia = watts/1000 × horas × R$/kWh
líquido = bruto BRL - energia - custo cloud
```

Se o usuário informar watts medidos na tomada, esse valor substitui as estimativas de potência.

### Risco

O painel executa Monte Carlo de 8.000 cenários para 30 dias. O objetivo é mostrar faixa de resultado e probabilidade de lucro/prejuízo; não prometer rendimento futuro.

## Cloud / outro PC

O IdeaGold não cria VPS nem usa máquinas de terceiros sem autorização. Para um servidor/PC que você controla:

1. instale/configure XMRig na máquina;
2. copie `worker-agent.js` e `.env.example`;
3. use o mesmo `WORKER_SHARED_SECRET` no servidor e worker;
4. informe `WORKER_POWER_WATTS`, `WORKER_ELECTRICITY_BRL_KWH` e `WORKER_CLOUD_COST_BRL_DAY`;
5. execute `node worker-agent.js`.

O worker só envia telemetria assinada; não fornece shell remoto ao painel.

## Testes

```bash
npm run check
npm test
```

O inicializador Windows executa essas verificações antes de subir o painel.

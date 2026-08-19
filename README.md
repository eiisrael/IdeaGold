# IdeaGold 4.1 — GoldBrain Real + Efficiency Lab

IdeaGold é um painel local para mineração autorizada em hardware que você controla. A linha estável atual usa XMRig verificado, MoneroOcean, telemetria real do minerador/pool, ETA estatística e cálculo de custo. A branch `agent/ideagold-v4-2-efficiency-lab` adiciona ferramentas **passivas e opt-in** para pesquisar eficiência sem alterar o caminho de mineração já validado.

## Regra de segurança desta branch

O minerador estável continua sendo `server-v4.js` + `index-v4.html`. O Efficiency Lab não troca algoritmo, não aplica overclock/undervolt, não cria VPS, não inicia mineração escondida e não substitui o XMRig funcionando sem benchmark real.

A prioridade é:

```text
1. dados reais
2. estabilidade
3. R$/W
4. receita bruta
5. H/s
```

Mais H/s não é melhoria se o custo elétrico subir mais do que a receita.

## Iniciar

No Windows, use:

```bat
INICIAR_IDEAGOLD.bat
```

O inicializador pede elevação de Administrador quando necessário para Huge Pages/MSR, executa `npm run check` e `npm test` e então inicia o painel local em:

```text
http://127.0.0.1:8080
```

Nunca coloque seed, private spend key, private view key ou senha da carteira no IdeaGold. O sistema usa apenas o endereço público XMR.

## Caminho estável atual

- XMRig oficial 6.26.0 verificado por SHA-256.
- RandomX estável como padrão.
- MoneroOcean por TLS.
- MSR, Huge Pages, ASM e modo RandomX fast solicitados.
- API do XMRig somente em `127.0.0.1`.
- Baseline por sessão para não confundir shares antigas com shares atuais.
- Hash efetivo XMR-normalizado do pool quando recente.
- Preço com múltiplas fontes e cache curto.
- ETA dinâmica; sem dados suficientes mostra aguardando em vez de inventar zero.
- Workers LAN/VPS/cloud somente em máquinas autorizadas e autenticados por HMAC.

## Efficiency Lab — modo sombra

O laboratório observa o IdeaGold já em execução e produz uma auditoria sem modificar configuração:

```bash
npm run efficiency:audit
```

Padrão: 3 minutos, amostra a cada 10 segundos.

Exemplo mais longo:

```bash
node tools/efficiency-audit.js --seconds=600 --interval=10
```

Se houver wattímetro, informe a potência real durante a mineração:

```bash
node tools/efficiency-audit.js --seconds=600 --mining-watts=82
```

Se o PC ficaria ligado mesmo sem mineração, é possível analisar **consumo incremental** com duas medições de tomada:

```bash
node tools/efficiency-audit.js --seconds=600 --mining-watts=82 --idle-watts=48 --cost-mode=incremental
```

Nesse exemplo, o custo atribuível à mineração é calculado sobre 34 W, e não sobre 82 W. Só use modo incremental quando as duas medições forem reais e comparáveis.

O relatório fica em `runtime/efficiency-audit-*.json` e contém mediana robusta/MAD, variabilidade, taxa XMR/h, custo, líquido, multiplicador necessário para break-even e prioridades técnicas.

## O que a “IA” faz

`lib/efficiency-brain.js` implementa um controlador estatístico leve, local e auditável:

- mediana + MAD para rejeitar picos de hashrate;
- score de candidato por lucro líquido quando potência é medida;
- fallback para H/W quando há potência medida mas não há economia completa;
- fallback de baixa confiança para hashrate quando não existe medição elétrica;
- bloqueio de candidato com temperatura acima do limite ou rejeição excessiva de shares;
- histerese: não troca configuração por melhoria pequena;
- UCB1 (multi-armed bandit) para explorar candidatos não medidos sem ficar trocando aleatoriamente.

Na fase atual ele roda em **modo sombra**: mede e recomenda. A aplicação automática de uma configuração só deve ser habilitada depois de benchmarks repetíveis no hardware real.

## Prioridade técnica para o SNIPER

O perfil atual é i5-4670K + RX 460 4 GB. Antes de integrar mais mineradores, corrija Huge Pages se o diagnóstico mostrar `0%`. RandomX precisa aproximadamente de 2 MB de L3 por thread; por isso 3 threads continuam sendo o ponto inicial sensato para 6 MB de L3, mas o vencedor final deve vir de benchmark real.

A RX 460 não é ativada automaticamente nesta branch. Mineradores modernos e algoritmos GPU mudam rapidamente e alguns projetos atuais não listam RX 460 como oficialmente suportada. A próxima etapa segura é um **capability probe** local: detectar OpenCL, VRAM, algoritmo e benchmark antes de permitir produção.

## Pesquisa técnica 2026

Veja `docs/RESEARCH-EFFICIENCY-2026.md` para o inventário verificado de XMRig, MoneroOcean Multi-Miner, MO-Miner, SRBMiner, LibreHardwareMonitor e trabalhos de DVFS/ML.

Resumo das decisões:

- **usar como referência/integração futura:** MoneroOcean Multi-Miner, MO-Miner capability probe, LibreHardwareMonitor, otimização estatística online;
- **manter:** XMRig oficial como fallback/estável;
- **não automatizar:** overclock, undervolt, BIOS, Secure Boot, drivers, cloud paga;
- **não instalar como padrão na RX 460:** minerador cuja documentação atual não inclua esse modelo ou que não passe no capability probe;
- **não usar:** projetos antigos sem manutenção como base do orquestrador atual.

## Arquivos principais

```text
server-v4.js                 backend estável
index-v4.html                interface atual
lib/goldbrain.js             estimador de produção/ETA/risco
lib/efficiency-brain.js      motor R$/W em modo sombra
tools/efficiency-audit.js    auditoria passiva
test/*.test.js               testes matemáticos
worker-agent.js              worker autorizado HMAC
hardware-profile.json        referência histórica do SNIPER
```

## Validação

```bash
npm run check
npm test
```

## Limites reais

IdeaGold pode reduzir desperdício, escolher configurações melhores e detectar quando uma configuração custa mais do que rende. Ele não altera a probabilidade matemática do PoW e não cria energia ou hashrate gratuito. Em hardware antigo com tarifa alta, a melhor decisão econômica pode ser reduzir carga ou não minerar; o software deve mostrar isso em vez de simular lucro.

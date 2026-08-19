# IdeaGold — pesquisa de eficiência e mineração assistida por IA (agosto/2026)

Este documento registra apenas técnicas que passaram por um filtro conservador: projeto ativo, fonte primária verificável, compatibilidade plausível e ausência de promessa de “hash grátis”. Vídeos e tutoriais foram procurados, mas não foram usados como fonte de verdade quando a informação não pôde ser confirmada na documentação/repositório atual.

## 1. XMRig oficial — manter como caminho estável

Fontes:
- https://github.com/xmrig/xmrig
- https://xmrig.com/docs/miner/randomx-optimization-guide
- https://xmrig.com/docs/miner/hugepages
- https://xmrig.com/docs/miner/randomx-optimization-guide/msr

Decisão: **manter**.

O IdeaGold já usa XMRig 6.26.0 verificado. O maior problema observado no SNIPER não é falta de “IA”: o diagnóstico real mostrou Huge Pages em 0%. A documentação do XMRig informa que Huge Pages normalmente melhoram algoritmos CPU em ~20–30% e podem chegar a ganhos maiores em RandomX. MSR também é importante e já aparece OK no SNIPER.

Ações seguras:
- tratar `huge pages 100%` como pré-requisito antes de comparar mineradores;
- manter MSR automático do XMRig;
- benchmark com mediana/variabilidade, não com um pico de 10 s;
- preservar XMRig oficial como fallback conhecido.

Não aplicar automaticamente:
- MSR customizado fora do preset oficial;
- Secure Boot/BIOS;
- prioridade extrema de CPU.

## 2. MoneroOcean Multi-Miner — referência forte para multi-algoritmo

Fonte:
- https://github.com/MoneroOcean/multi-miner

Estado observado: projeto ativo em 2026.

Recursos relevantes:
- stratum local em `127.0.0.1`;
- troca por algoritmo;
- benchmark para preencher performance por algoritmo;
- watchdog e hashrate-watchdog;
- parser de hashrate para vários mineradores;
- diagnóstico sem contato externo;
- sem taxa adicional do Multi-Miner.

A documentação atual cita como algoritmos GPU do ecossistema MoneroOcean `autolykos2`, `c29`, `cn/gpu`, `etchash` e `kawpow`.

Decisão: **usar como referência e possível camada futura**, mas não substituir a V4.1 imediatamente. O IdeaGold deve adotar as ideias de benchmark persistente, watchdog por queda de hashrate e configuração por algoritmo. A integração binária só deve ocorrer depois de um teste isolado no hardware do usuário.

## 3. MoneroOcean MO-Miner (`mom`) — candidato experimental mais interessante

Fonte:
- https://github.com/MoneroOcean/mo-miner

Estado observado: ativo em 2026, minerador CPU/GPU aberto, com backend Node.js/SYCL e fontes de hashing CPU derivadas do XMRig.

Recursos relevantes:
- CPU: algoritmos de CPU do XMRig;
- GPU: múltiplos algoritmos e backends;
- `algo_params` para detectar dispositivos e medir parâmetros;
- benchmark de algoritmos na primeira execução;
- configuração salva para não repetir benchmark completo;
- `--gpu_tune 1`: busca empírica limitada em parâmetros próximos e salva candidato somente se for pelo menos 2% mais rápido que a heurística;
- backend genérico OpenCL disponível.

Decisão: **capability probe futuro, nunca ativação cega**.

A documentação atual mede GPUs modernas (B580, RTX 5060 Ti, RX 9060 XT), não uma RX 460. Portanto, não existe base suficiente para afirmar que o ganho será positivo no Polaris/Baffin do SNIPER. A implementação correta no IdeaGold é:

1. detectar se `mom algo_params` realmente enxerga a RX 460;
2. listar algoritmos que passam no teste local;
3. bloquear qualquer algoritmo que exceda VRAM;
4. benchmark isolado;
5. validar share real no pool;
6. comparar R$/W com XMRig estável;
7. só então tornar o candidato elegível.

## 4. SRBMiner-Multi — ativo, mas não é candidato padrão para RX 460

Fonte:
- https://github.com/doktor83/SRBMiner-Multi

O projeto está ativo e oferece muitos algoritmos CPU/GPU. A documentação atual, porém, lista no grupo Polaris as RX 470/480/570/580/590 e **não lista RX 460**.

Decisão: **não instalar automaticamente no SNIPER**.

Pode continuar como referência de arquitetura (autotune, multi-algoritmo, dual mining), mas IdeaGold não deve assumir compatibilidade de produção com a RX 460.

## 5. lolMiner — possível laboratório para Polaris, não produção automática

Fonte:
- https://github.com/Lolliedieb/lolMiner-releases

O ecossistema MoneroOcean Multi-Miner possui exemplos atuais de lolMiner para `autolykos2`, `etchash` e `c29`. Há histórico de suporte a RX 400 em alguns algoritmos, mas requisitos de memória variam e mudam com cada algoritmo.

Decisão: **candidato a benchmark manual/isolado**, não padrão. Para RX 460 4 GB, o IdeaGold deve verificar VRAM e alocação real antes de executar.

## 6. LibreHardwareMonitor — alta prioridade para telemetria local

Fonte:
- https://github.com/LibreHardwareMonitor/LibreHardwareMonitor

Projeto ativo em 2026. Monitora temperaturas, ventoinhas, tensões, carga e clocks; alguns sensores também fornecem potência.

Decisão: **boa integração futura**, com restrições:
- somente interface local;
- não expor servidor de sensores para LAN/Internet;
- usar temperatura/carga/clock para guardrails;
- tratar sensores de potência como parciais, não como substitutos automáticos de wattímetro de tomada.

O wattímetro continua sendo a fonte mais confiável para custo elétrico total do PC.

## 7. “IA” aplicada à energia: o que é real

Fontes acadêmicas:
- DSO: A GPU Energy Efficiency Optimizer by Fusing Dynamic and Static Information — https://arxiv.org/abs/2407.13096
- Energy-Efficient Computation with DVFS using Deep Reinforcement Learning — https://arxiv.org/abs/2409.19434

Esses trabalhos mostram que modelos orientados por telemetria e DVFS podem melhorar eficiência em hardwares/workloads testados. Eles **não provam** o mesmo ganho numa RX 460 minerando e não justificam controle automático de tensão no IdeaGold.

Decisão: aproveitar o princípio, não copiar números.

O controlador seguro do IdeaGold deve aprender a partir de:
- hashrate robusto;
- shares aceitas/rejeitadas;
- XMR/h real/normalizado;
- watts medidos;
- temperatura;
- clock/carga;
- preço/tarifa;
- estabilidade ao longo do tempo.

Objetivo:

```text
maximizar: líquido BRL/dia
sujeito a:
  temperatura <= limite
  rejeição <= limite
  estabilidade >= limite
  ganho mínimo antes de trocar configuração
```

## 8. Algoritmo de decisão escolhido para o IdeaGold

O `Efficiency Brain` adiciona componentes simples e auditáveis:

- **mediana + MAD:** picos de pool/hash não vencem sozinhos;
- **histerese:** exige melhoria mínima antes de trocar;
- **UCB1:** multi-armed bandit que explora candidatos pouco testados e depois privilegia os melhores;
- **guardrails:** temperatura e rejeição podem invalidar um candidato;
- **score econômico:** quando watts são medidos, lucro líquido ganha prioridade sobre H/s;
- **modo sombra:** primeiro recomenda, só depois de validação deve controlar automaticamente.

Isso é mais apropriado para mineração que um LLM tomando decisões livres.

## 9. Consumo incremental — melhoria importante de contabilidade

Se o PC já ficaria ligado sem mineração, cobrar todo o consumo do computador como “custo da mineração” pode ser incorreto. Com duas medições de wattímetro:

```text
watts incrementais = watts minerando - watts ocioso
custo incremental = watts incrementais / 1000 × horas × tarifa
```

O Efficiency Lab suporta esse cálculo. Ele não deve ser usado com números inventados: idle e mining precisam ser medidos em condições comparáveis.

## 10. Cloud

Cloud não é fonte de hash gratuito. Uma instância só entra no conjunto de candidatos se:

```text
receita adicional > aluguel + energia + taxas
```

Além disso, o provedor precisa permitir mineração. IdeaGold mantém workers autorizados, mas não deve provisionar ou iniciar cloud paga automaticamente.

## 11. Limpeza de legado identificada

Na branch 4.1 foram encontrados arquivos de versões anteriores que não fazem parte do runtime atual:

- `server.js` — backend V3 antigo; runtime atual usa `server-v4.js`;
- `index.html` — UI V3 antiga; runtime atual serve `index-v4.html`;
- `README_V3.md` — documentação antiga;
- `README.md` — ainda descrevia IdeaGold 2.0 e foi substituído;
- `Dockerfile` — ainda executava `node server.js`, incompatível com o caminho atual de mineração Windows;
- `README_V4.md` — duplicação de documentação depois da consolidação no README principal.

A limpeza deve remover apenas esses arquivos comprovadamente fora do caminho atual. `hardware-profile.json` e `SNIPER-PROFILE.md` ficam preservados porque ainda contêm referência útil do hardware, mesmo não sendo runtime.

## 12. Ordem de implementação recomendada

### Fase A — segura e imediata
1. preservar V4.1 estável;
2. corrigir Huge Pages 0%;
3. coletar 5–10 min de auditoria robusta;
4. medir watts na tomada;
5. medir idle watts se o PC já fica ligado;
6. limpar legado;
7. usar Efficiency Brain em modo sombra.

### Fase B — benchmark controlado
1. comparar 2/3/4 threads;
2. exigir janela estável e shares válidas;
3. usar H/W e líquido/dia, não H/s isolado;
4. persistir resultado por fingerprint de hardware;
5. re-testar somente quando driver/miner/algoritmo mudar.

### Fase C — GPU experimental
1. capability probe OpenCL;
2. testar MO-Miner em sandbox local;
3. testar somente algoritmos compatíveis com 4 GB;
4. validar shares;
5. medir watts e temperatura;
6. habilitar produção apenas se superar a configuração estável por margem mínima.

## 13. O que não será prometido

Nenhuma dessas técnicas garante transformar o i5-4670K + RX 460 em mineração lucrativa com tarifa alta. O ganho possível é reduzir desperdício e localizar o melhor ponto de operação disponível. Se o melhor ponto continuar negativo, o software deve dizer isso claramente e preservar o hardware/dinheiro do usuário.

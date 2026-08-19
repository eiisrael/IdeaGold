# Perfil SNIPER — IdeaGold 2.1

Perfil construído a partir do diagnóstico local informado em 19/08/2026:

- Intel Core i5-4670K, 4 cores / 4 threads, 6 MB L3
- Radeon RX 460 4 GB
- 23,72 GB RAM
- Gigabyte G1.Sniper H6
- Windows 10 Pro 19045
- tarifa: R$ 0,90/kWh
- consumo total na tomada: ainda não medido

## CPU / RandomX

Benchmarks validados do XMRig para o i5-4670K ficam aproximadamente entre 1,77 e 2,02 kH/s. O perfil usa 1.950 H/s como referência e 3 threads como ponto inicial. Assim que houver um resultado real, ele deve substituir a referência.

A configuração sugerida usa Huge Pages, MSR, AVX2 na inicialização do dataset, ASM, 3/4 threads por padrão, API XMRig somente em `127.0.0.1` e OpenCL desligado no perfil XMR.

## Energia

Modo dedicado, quando o computador só está ligado por causa da mineração:

`W_total = W_mineracao + W_base_do_PC`

`custo_dia = (W_total / 1000) × horas × tarifa`

Modo incremental, quando o computador já ficaria ligado:

`W_total = W_mineracao`

O perfil começa com 50 W de overhead, 65 W de CPU e 47 W de GPU. São estimativas até haver wattímetro.

## Receita RandomX / Monero

`blocos_esperados_dia = (hashrate × 86400 × uptime) / dificuldade`

`XMR_dia = blocos_esperados_dia × recompensa × (1 - taxa_pool)`

`receita_BRL_dia = XMR_dia × preço_XMR_BRL`

`lucro_BRL_dia = receita_BRL_dia - custo_energia_dia`

## RX 460 4 GB

Perfis de teste: Autolykos2, SHA3X e FishHash via lolMiner. KawPow fica bloqueado neste perfil porque a referência recente usada na calibração indica DAG de cerca de 5,625 GB, acima dos 4 GB instalados.

Autolykos2 usa referência inicial de ~29,07 MH/s / 47 W, mas é obrigatório medir sua RX 460 antes de tratar isso como resultado real.

## Profit Guard

O sistema compara sempre desligado (R$ 0), CPU / RandomX, GPU e CPU + GPU. Se todas as alternativas forem negativas, desligar vence matematicamente.

Referências: XMRig benchmark e documentação oficial; lolMiner releases; Minerstat RX 460. Referências de rentabilidade não garantem lucro futuro.

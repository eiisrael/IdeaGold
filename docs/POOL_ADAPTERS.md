# Pool Adapters

A UI não chama APIs específicas de pool diretamente. O backend seleciona um adapter.

## Interface conceitual

```text
connection()
walletStats(wallet)
networkStats()
workers(wallet)     # quando suportado
```

Campos ausentes permanecem `null`/`available:false`.

## MoneroOcean

Adapter padrão desta revisão. Fornece saldo devido/pago, hash normalizado quando disponível, accepted/rejected, última share, network stats e workers.

A senha do worker fixa `~rx/0` no modo estável para não anunciar auto-switch como se estivesse ativo quando a V5 está priorizando XMR/RandomX CPU.

## P2Pool

Adapter opcional. Primeiro testa o Stratum local (padrão `127.0.0.1:3333`). Métricas detalhadas requerem `P2POOL_DATA_API` apontando para os arquivos/API locais do P2Pool.

Sem data-api, o adapter retorna `stratum-only` e **não inventa saldo/hash/shares**.

## Pool Score

Score é explicável e só usa itens realmente disponíveis: disponibilidade, ping, fee, reject rate, estabilidade e mínimo de payout. A resposta lista `missing` para não transformar falta de dado em nota falsa.

Troca automática de pool não é habilitada nesta revisão com base em janelas curtas. O usuário escolhe o adapter nas configurações.

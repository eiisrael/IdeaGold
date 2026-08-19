# IdeaGold 2.0 — GoldMesh

IdeaGold 2.0 é um painel de **mineração distribuída autorizada**. Ele não promete lucro e não tenta transformar o navegador em um minerador milagroso. O servidor centraliza telemetria, preço, rentabilidade, configuração de XMRig e conversão via exchanges; cada máquina/VPS que você controla roda o `worker-agent.js` ao lado do XMRig.

## O que existe nesta V2

- Dashboard responsivo com preços BTC/XMR/ETH/LTC em USD e BRL.
- **GoldMesh Workers:** múltiplos workers, heartbeat assinado com HMAC e detecção de offline.
- Integração com a HTTP API oficial do **XMRig** sem precisar expor essa API para a internet.
- Gerador de `config.json` do XMRig para pool/P2Pool.
- Motor de rentabilidade para:
  - SHA-256/Bitcoin-like (`difficulty × 2^32`);
  - RandomX/Monero-like (difficulty como hashes esperados por bloco).
- Custos de energia, cloud/VPS, taxa de pool, uptime, break-even e projeção.
- Cotações via **CoinGecko**.
- Exchanges via **CCXT**. Padrão: `mercado` e `kraken`.
- Cotação de conversão e consulta de saldo.
- Ordem de mercado REAL somente após:
  1. credenciais no servidor;
  2. `ENABLE_LIVE_TRADING=true`;
  3. confirmação textual `CONVERTER_AGORA`;
  4. limite `MAX_LIVE_TRADE_BRL`.

## Arquitetura

```text
┌──────────────────────── IdeaGold Server ─────────────────────────┐
│ Dashboard HTML                                                   │
│ API Node.js                                                      │
│ CoinGecko -> preços                                              │
│ CCXT -> exchange / saldo / ordens                                │
│ GoldMesh -> workers assinados HMAC                               │
└──────────────────────────────┬────────────────────────────────────┘
                               │ HTTPS
                  ┌────────────┴────────────┐
                  │                         │
           Worker/VPS 1                Worker/VPS 2
           worker-agent.js             worker-agent.js
                  │                         │
            127.0.0.1 API              127.0.0.1 API
                  │                         │
                XMRig                     XMRig
                  │                         │
             Pool/P2Pool               Pool/P2Pool
```

O agente **não oferece shell remoto** e não baixa minerador escondido. O operador instala o XMRig e escolhe o pool/carteira. Se `AUTO_START_XMRIG=true`, o agente só inicia um binário local chamado `xmrig`/`xmrig.exe`.

## Instalação do painel

Requisitos: Node.js 20+.

```bash
git clone https://github.com/eiisrael/IdeaGold.git
cd IdeaGold
npm install
cp .env.example .env
node server.js
```

Abra `http://127.0.0.1:8080`.

Gere um segredo forte:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Coloque o mesmo valor em `WORKER_SHARED_SECRET` no servidor e em cada worker.

## Worker XMRig

1. Instale XMRig pelo projeto oficial.
2. Configure o HTTP API para `127.0.0.1`, por exemplo porta `18080`.
3. No worker, tenha `worker-agent.js`, `package.json` e `.env`.
4. Ajuste:

```env
IDEAGOLD_SERVER=https://SEU-PAINEL
WORKER_SHARED_SECRET=O_MESMO_SEGREDO
WORKER_ID=rig-01
WORKER_NAME=VPS-01
XMRIG_API=http://127.0.0.1:18080/2/summary
```

5. Rode:

```bash
node worker-agent.js
```

Para P2Pool, o XMRig normalmente aponta para o Stratum local do P2Pool (ex.: `127.0.0.1:3333`). Use uma carteira de mineração apropriada e siga os requisitos oficiais do Monero/P2Pool.

## Exchange e conversão para BRL

O IdeaGold não recebe seed phrase nem chave privada de carteira. Para converter valores, use uma conta de exchange e chave de API.

Exemplo Mercado Bitcoin:

```env
MERCADO_API_KEY=...
MERCADO_SECRET=...
ENABLE_LIVE_TRADING=false
MAX_LIVE_TRADE_BRL=500
```

Comece com `false`. O painel consegue fazer **cotação pública** sem chave. Após validar saldo e permissões, você pode habilitar trading real. A ação "Converter" cria uma ordem de mercado pelo CCXT; por exemplo `BTC/BRL` vende BTC e gera saldo em BRL na sua conta da exchange.

**Saque do BRL para banco/Pix:** faça no app/site oficial da exchange, especialmente enquanto você estiver validando os parâmetros bancários da sua conta. A API do Mercado Bitcoin oferece saques fiat/cripto, mas parâmetros bancários e destinos confiáveis são específicos da conta; esta V2 evita automatizar essa última etapa para não enviar dinheiro a um destino incorreto.

## Segurança

- Não publique `.env`.
- Nunca coloque seed phrase/chave privada no IdeaGold.
- Use chaves de exchange com o mínimo de permissões.
- Para painel exposto à internet, use HTTPS via reverse proxy.
- Deixe a API do XMRig em `127.0.0.1`.
- Troque `WORKER_SHARED_SECRET`.
- Mantenha `ENABLE_LIVE_TRADING=false` até concluir testes.
- Respeite os termos do provedor cloud; mineração pode ser proibida ou economicamente inviável em determinadas instâncias.

## Docker

```bash
docker build -t ideagold:2 .
docker run --rm -p 8080:8080 --env-file .env ideagold:2
```

## Fontes técnicas usadas na arquitetura

- XMRig + HTTP API.
- Monero/P2Pool.
- CCXT para normalização de exchanges.
- CoinGecko para preço.
- Mercado Bitcoin como rota brasileira opcional para pares em BRL.

## Limitações importantes

Rentabilidade é probabilística. CPU/GPU comum não substitui ASIC em Bitcoin. "Cloud mining" não cria poder computacional grátis: é necessário hardware próprio, VPS permitido pelo provedor, contrato de hashrate ou ASIC/pool reais. O objetivo da V2 é **orquestrar, medir e converter**, não simular ganhos inexistentes.

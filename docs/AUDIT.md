# Auditoria do IdeaGold antes da V5

## Stack encontrada

A linha 4.1 era Node.js + HTML/CSS/JS sem framework, `server-v4.js` como backend/controle, `index-v4.html` como UI, `lib/goldbrain.js` para ETA/economia e `worker-agent.js` para workers autorizados. O XMRig oficial era o motor estável, com MoneroOcean como pool principal.

## Funcionalidades reais preservadas

- XMRig 6.26.0 com checksum fixado;
- RandomX CPU;
- start/stop/restart;
- API XMRig localhost;
- pool stats MoneroOcean;
- preço com fallback;
- baseline de shares/saldo por sessão;
- ETA probabilística;
- workers HMAC autorizados;
- Huge Pages/MSR solicitados.

## Problemas/dívida técnica encontrados

- backend e UI grandes e monolíticos;
- histórico persistido em JSON, sem banco relacional;
- adapters de pool/market/hardware não estavam isolados;
- V4 mantinha arquivos antigos e caminhos conceituais de versões anteriores;
- temperatura/potência tinham cobertura limitada;
- autotuning avançado ainda não estava integrado ao runtime principal;
- não havia Decision Log/Last Known Good completo em banco;
- páginas Benchmark/Profiles/History/Supreme Mind ainda não formavam uma plataforma uniforme.

## Mudança V5

A V5 cria `backend/`, `miner/`, `telemetry/`, `providers/`, `optimizer/`, `database/`, `frontend/`, `tests/` e `docs/`. A V4 permanece no histórico Git como rollback lógico, mas o runtime V5 inicia `backend/server.js`.

## Regra de realidade

`null/indisponível/aguardando` é preferido a um valor fabricado. Ganho real é saldo observado; lucro/ETA são explicitamente estimativas quando derivam de modelo.

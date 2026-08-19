# Arquitetura IdeaGold 5.0

```text
Browser UI
   │  HTTP + SSE (localhost)
   ▼
backend/server.js
   ├─ SettingsStore
   ├─ XMRigController ──> XMRig official ──> Pool
   ├─ TelemetryEngine
   │    ├─ HardwareProvider
   │    ├─ PowerProvider
   │    ├─ PoolAdapter
   │    └─ MarketProvider
   ├─ ProfitEngine
   ├─ SQLite
   └─ SupremeMind
        ├─ SafetyEngine
        ├─ BenchmarkEngine
        ├─ Robust Statistics
        ├─ Bayesian Optimizer
        ├─ Anomaly Detector
        └─ Decision Log / Rollback
```

## Fluxo Supreme Mind

```text
telemetria real
→ features observáveis
→ objetivo escolhido
→ candidate config
→ Safety Validator
→ benchmark com warm-up
→ amostragem
→ robust statistics/confidence
→ comparação com baseline
→ WIN: salvar perfil + Last Known Good
→ LOSS/crash/térmico: rollback
```

## Fronteiras de confiança

- Frontend nunca recebe seed/private key porque backend não as solicita.
- Alterações de estado exigem request vindo de loopback.
- XMRig API fica em `127.0.0.1:18080`.
- Adapters externos retornam `available:false`/`null` em falha.
- SQLite e runtime ficam em `data/` e `runtime/`, ignorados pelo Git.

## Estado real versus estimado

**Real:** processo XMRig, hash API local, accepted/rejected, pool balance, preço recebido de API, sensor/wattmeter quando disponível.

**Estimado:** receita futura, ETA, watts de perfil sem sensor, break-even e projeções de cenários.

**Indisponível:** qualquer métrica cuja fonte não exista. A UI não a substitui por números arbitrários.

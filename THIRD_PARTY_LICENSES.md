# Third-Party Licenses

IdeaGold 5.0 does not vendor third-party miner source code in this branch. External projects are invoked/downloaded as separate components or used only as architectural references.

## XMRig

- Project: `xmrig/xmrig`
- License: GPL-3.0
- Role: external mining executable controlled by IdeaGold.
- IdeaGold auto-downloads only a pinned official release asset and verifies its SHA-256 before execution.
- XMRig's own copyright/license remains with its authors.

## P2Pool

- Project: `SChernykh/p2pool`
- License: GPL-3.0
- Role: optional external local pool/node integration. No P2Pool source is copied into IdeaGold.

## RigForge

- Project: `p2pool-starter-stack/rigforge`
- License observed in repository audit: MIT.
- Role: architectural inspiration for hardware-aware tuning and A/B validation. V5 implementation is independent.

## Pithead

- Project: `p2pool-starter-stack/pithead`
- Project-owned code LICENSE observed as MIT; its distribution/documentation notes bundled third-party components retain their own licenses.
- Role: architecture inspiration for monitoring/adapters/health/history; no code copied.

## Crypto Miner Optimizer

- Project: `NeuroKoder3/crypto-miner-optimizer`
- License: MIT.
- Role: UI information architecture inspiration. No source copied.

## MineROI-Net

- Project: `AMAAI-Lab/MineROI-Net`
- License: not identified by the repository metadata during this audit.
- Role: conceptual time-series/economic reference only. No code copied.

## Chimera

- Project: `deskiziarecords/chimera`
- License: not identified by repository metadata during this audit.
- Role: conceptual modular-agent architecture only. No code copied.

## OxideMiner

- Requested repository path `raystanza/OxideMiner` returned Not Found during the audit.
- No code, license or architecture was assumed/reused.

## TNN Miner

- Project: `Tritonn204/tnn-miner`
- License: MIT.
- Current repository describes an AstroBWTv3 miner; used only as a general miner-architecture reference, not a RandomX implementation.

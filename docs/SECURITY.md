# Segurança

IdeaGold é exclusivamente para mineração em hardware/servidores que o usuário controla e autorizou.

## Proibições do projeto

Não existem recursos para mineração escondida, persistência furtiva, evasão de antivírus, desativação de proteção, propagação, roubo de credenciais, wallet stealing, clipboard hijacking ou execução em máquinas não autorizadas.

## Carteira

Para mineração é aceito somente o **endereço público XMR**. Não informe seed phrase, private spend key, private view key ou senha da carteira.

## Rede

- backend: `127.0.0.1` por padrão;
- XMRig API: `127.0.0.1:18080`;
- endpoints mutáveis validam conexão loopback;
- P2Pool local é opcional;
- sensor customizado deve apontar para localhost.

## Supply chain

O auto-installer Windows usa release oficial XMRig fixada e compara SHA-256 antes da extração/execução. Binário indicado via `XMRIG_PATH` é tratado como fornecido pelo usuário e não recebe selo de checksum oficial do IdeaGold.

## Configuração e rollback

- `config.generated.json`: gerado pelo IdeaGold;
- `config.user.json`: importado/salvo pelo usuário;
- `config.safe.json`: Last Known Good;
- arquivos existentes recebem backup antes de sobrescrita;
- decisões automáticas entram no Decision Log.

## Recovery

Watchdog limita auto-recovery a 3 tentativas em 15 minutos. Depois disso, o sistema para de reiniciar e registra alerta, evitando loop infinito.

## Privilégio elevado

No Windows o launcher informa antes de solicitar UAC. Administrador é usado para recursos como Huge Pages/MSR do minerador; não é usado para desativar segurança do sistema.

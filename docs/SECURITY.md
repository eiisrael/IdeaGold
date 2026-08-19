# Segurança

IdeaGold é exclusivamente para mineração em hardware/servidores que o usuário controla e autorizou.

## Proibições do projeto

Não existem recursos para mineração escondida, persistência furtiva, evasão de antivírus, desativação de proteção, propagação, roubo de credenciais, wallet stealing, clipboard hijacking ou execução em máquinas não autorizadas.

## Carteira

Para mineração é aceito somente o **endereço público XMR**. Não informe seed phrase, private spend key, private view key ou senha da carteira.

## Rede

- backend: `127.0.0.1` por padrão;
- XMRig API: `127.0.0.1:18080`;
- endpoints que alteram minerador/configuração validam conexão loopback;
- logs administrativos exigem loopback;
- P2Pool local é opcional;
- sensor customizado deve apontar para localhost.

Se workers de outros computadores autorizados precisarem enviar telemetria, o operador pode mudar explicitamente `HOST=0.0.0.0`. Nesse caso deve limitar a porta 8080 no firewall às origens necessárias. O IdeaGold não abre portas/firewall automaticamente.

## Workers autorizados

O endpoint `/api/workers/heartbeat` é a única rota mutável projetada para receber dados de outra máquina. Ele não oferece shell, execução de comando ou instalação remota.

Cada heartbeat exige:

- `WORKER_SHARED_SECRET` com pelo menos 16 caracteres e diferente do placeholder;
- HMAC-SHA256 sobre `timestamp + "." + corpo JSON exato`;
- timestamp dentro de uma janela máxima de 5 minutos;
- assinatura hexadecimal válida comparada com `crypto.timingSafeEqual`;
- rejeição de replay da mesma assinatura durante a janela ativa;
- payload com tamanho limitado e campos normalizados.

Workers deixam de ser considerados online após 45 segundos sem heartbeat. Registros antigos são limpos do banco após 30 dias.

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

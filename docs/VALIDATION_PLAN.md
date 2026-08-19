# IdeaGold 5 — Validation Gate

A release/merge só é considerada pronta quando todos os gates abaixo passam:

1. `npm ci` em checkout limpo.
2. `npm run check` sem erro de sintaxe/importação estática.
3. `npm test` com cálculos, estatística, optimizer, pool score e segurança aprovados.
4. Inicialização local vinculada somente a `127.0.0.1` por padrão.
5. Nenhum endpoint mutável aceito fora de loopback.
6. XMRig só é obtido de origem oficial e validado por SHA-256.
7. Configuração manual não é apagada; generated/safe/user são separados.
8. Métrica indisponível permanece explicitamente indisponível/estimada/aguardando.
9. Supreme Mind não é anunciado como deep learning; UI identifica Rules, Statistical Model, Bayesian Optimizer e ML somente quando houver modelo/dataset.
10. Autotune possui warm-up, amostra mínima, segurança, cancelamento e rollback para Last Known Good.
11. Mineração exige ação explícita e é sempre interrompível.
12. P2Pool é opcional e não substitui pool tradicional automaticamente.

O CI de Windows/Node 26 é o gate automatizado mínimo. Testes com XMRig/hardware real permanecem integração local porque GitHub Actions não oferece o CPU/driver/pool do usuário.

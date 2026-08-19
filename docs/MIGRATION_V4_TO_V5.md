# Migração 4.1 → 5.0

A versão 5 é mantida em branch separada para que a 4.1 funcional continue recuperável.

## Estratégia

1. Atualizar a branch 5 em checkout separado ou trocar de branch apenas com worktree limpo.
2. Manter `.env`, `runtime/` e `data/` fora do Git.
3. Não reutilizar automaticamente configuração antiga do XMRig como configuração segura.
4. Na primeira execução, o IdeaGold 5 detecta hardware/XMRig e exige carteira pública antes de minerar.
5. O usuário informa tarifa de energia e, quando possível, watts medidos.
6. Rodar baseline antes de habilitar autotuning.
7. Supreme Mind inicia com políticas seguras e só promove candidato medido como Last Known Good.

## Rollback

A branch 4.1 permanece intacta. Dentro da versão 5, mudanças de perfil também possuem rollback para `config.safe.json`.

## Dados

O banco/histórico da v5 usa armazenamento próprio. Dados antigos não são inventados nem transformados automaticamente em telemetria v5; podem ser mantidos como referência histórica separada.

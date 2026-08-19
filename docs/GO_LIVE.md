# Go-live IdeaGold 5

O usuário só deve substituir a versão 4.1 pela 5.0 após:

- CI verde no Pull Request;
- checkout local limpo;
- `npm ci`, `npm run check` e `npm test` aprovados;
- primeira inicialização com carteira pública correta;
- confirmação de XMRig API, pool e preço;
- benchmark inicial;
- observação de pelo menos uma janela real de shares antes de confiar em ETA/rendimento.

Caso qualquer etapa falhe, retornar à 4.1 ou restaurar Last Known Good; não mascarar o erro com valores simulados.

# Instalação — Windows

## Requisitos

- Windows 10/11 x64;
- Node.js 22.5+;
- internet para preço/pool e para o primeiro download do XMRig oficial;
- endereço público XMR.

## Iniciar

Execute `INICIAR_IDEAGOLD.bat`. O script:

1. explica por que Administrator é solicitado;
2. pede UAC para Huge Pages/MSR;
3. verifica Node;
4. cria `.env` a partir do exemplo se necessário;
5. roda `npm run check`;
6. roda `npm test`;
7. abre `http://127.0.0.1:8080`;
8. inicia `backend/server.js`.

Na primeira mineração, o IdeaGold pode baixar a release XMRig fixada, verificar SHA-256 e só então extrair.

## Temperatura/potência

Sem sensor confiável, temperatura fica `indisponível` e potência pode ficar `estimada`. Para custo real, informe watts medidos na tomada. Um sensor local opcional pode ser exposto em localhost e configurado por `IDEAGOLD_SENSOR_URL`.

## Huge Pages

Execute como Administrador para permitir os recursos necessários do RandomX. Se o diagnóstico continuar mostrando Huge Pages ausentes, reinicie o Windows depois da primeira concessão de privilégio de páginas grandes e teste novamente.

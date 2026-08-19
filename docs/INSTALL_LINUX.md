# Instalação — Linux

A V5 prepara abstração de hardware/power, mas o auto-download fixado nesta revisão é específico do Windows x64. No Linux use o XMRig oficial instalado pelo usuário.

```bash
export XMRIG_PATH=/caminho/para/xmrig
npm run check
npm test
npm start
```

Abra `http://127.0.0.1:8080`.

Para RandomX eficiente, configure Huge Pages/MSR conforme a documentação oficial do XMRig e os limites da sua distribuição. Não rode scripts de tuning desconhecidos como root.

Sensores futuros podem usar provider Linux (`/proc`, `/sys`, `sensors`); até a fonte existir, o IdeaGold deve mostrar a métrica como indisponível/estimada, nunca inventada.

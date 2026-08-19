'use strict';
const {createApp,VERSION}=require('./app');
const HOST=process.env.HOST||'127.0.0.1';
const PORT=Number(process.env.PORT||8080);
const app=createApp();
app.server.listen(PORT,HOST,()=>{
  console.log(`\nIdeaGold ${VERSION} Mining Intelligence Platform`);
  console.log(`http://${HOST}:${PORT}`);
  console.log('Local-first. Mineração só inicia por ação explícita do usuário.');
});
function shutdown(){try{app.telemetry.stop();}catch{}try{app.store.close();}catch{}process.exit(0);}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);

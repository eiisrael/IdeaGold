'use strict';

// Compatibilidade defensiva: V5.0 enviava ocasionalmente um status inteiro no evento telemetry.
// V5.1 corrige o backend, mas esta função também desaninhará um payload legado em trânsito/cache.
current=function(){
  const t=state.status?.telemetry;
  if(t&&typeof t==='object'&&t.telemetry&&typeof t.telemetry==='object')return t.telemetry;
  return t||{};
};

function hugePagesV511(value){
  if(Array.isArray(value)&&value.length>=2){const used=Number(value[0]||0),total=Number(value[1]||0),pct=total>0?100*used/total:null;return pct==null?'aguardando':`${n(pct,0)}% (${used}/${total})`;}
  if(value&&typeof value==='object'){
    const used=Number(value.used??value[0]??0),total=Number(value.total??value[1]??0);if(total>0)return`${n(100*used/total,0)}% (${used}/${total})`;
    return esc(JSON.stringify(value));
  }
  return value==null?'aguardando':esc(String(value));
}

const hardwarePageV511=hardwarePage;
hardwarePage=function(){
  const s=current(),m=s.miner||{};
  return `${hardwarePageV511()}<div class="card advanced-v51"><h3>RandomX / Huge Pages / estabilidade</h3><div class="metric-list">${metric('Huge Pages REAL',hugePagesV511(m.hugePages))}${metric('Huge Pages solicitado',m.profile?.hugePages===false?'não':'sim')}${metric('MSR solicitado',m.profile?.rdmsr===false?'não':'sim')}${metric('API XMRig',m.apiConnected?'OK':'desconectada')}${metric('Último exit code',m.exitCode==null?'—':esc(m.exitCode))}${metric('Última saída inesperada',m.unexpectedExit?'SIM':'não')}</div><p class="muted">O estado real de Huge Pages vem da API do XMRig. Detalhes de MSR e falhas de inicialização ficam no XMRig Log.</p></div>`;
};

const settingsPageV511=settingsPage;
settingsPage=function(){
  return settingsPageV511()
    .replace('Permitir start/pause automático pela agenda','Permitir pausa/retomada automática pela agenda')
    .replace('Scheduler real','Scheduler / Profit Guard')
    .replace('Scheduler vem DESLIGADO por padrão. Ele só poderá pausar automaticamente depois que você ativá-lo explicitamente.','Scheduler vem DESLIGADO por padrão. Ele nunca inicia mineração do zero: somente pausa e retoma uma mineração que você já iniciou, e apenas se ele próprio tiver causado a pausa.');
};

// Atualização final após a camada de compatibilidade ser carregada.
refreshStatus().then(()=>{render();dataNotice();}).catch(()=>{});

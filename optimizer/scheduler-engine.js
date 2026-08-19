'use strict';

function minutesOfDay(text){const m=String(text||'00:00').match(/^(\d{2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):0;}
function insideWindow(now,start,stop){const cur=now.getHours()*60+now.getMinutes(),a=minutesOfDay(start),b=minutesOfDay(stop);if(a===b)return true;if(a<b)return cur>=a&&cur<b;return cur>=a||cur<b;}

class SchedulerEngine{
  constructor({controller,getSettings,getContext,getTelemetry,logger=null,db=null}){Object.assign(this,{controller,getSettings,getContext,getTelemetry,logger,db});this.timer=null;this.pausedByScheduler=false;this.lastAction=null;}
  start(){if(this.timer)return;this.timer=setInterval(()=>this.tick().catch(e=>this.logger?.error('scheduler','tick-error','Falha no Scheduler.',e)),30000);this.timer.unref?.();this.logger?.info('scheduler','start','Scheduler Engine ativo; nenhuma ação ocorre enquanto disabled.');}
  stop(){if(this.timer)clearInterval(this.timer);this.timer=null;}
  snapshot(){const s=this.getSettings().scheduler||{};return{...s,insideWindow:insideWindow(new Date(),s.start,s.stop),pausedByScheduler:this.pausedByScheduler,lastAction:this.lastAction};}
  record(action,reason,data={}){this.lastAction={ts:Date.now(),action,reason,...data};this.logger?.info('scheduler',action,reason,data);this.db?.addDecision({engine:'Scheduler',objective:this.getSettings().objective,action,reason,before:null,after:null,confidence:1,result:'SCHEDULED'});}
  async tick(){
    const settings=this.getSettings(),cfg=settings.scheduler||{},state=this.controller.state(),telemetry=this.getTelemetry();
    if(!cfg.enabled){this.pausedByScheduler=false;return this.snapshot();}
    const windowOk=insideWindow(new Date(),cfg.start,cfg.stop),net=telemetry?.economics?.available?Number(telemetry.economics.rows?.day?.netBrl):null,profitOk=!cfg.stopWhenNegative||net==null||net>=Number(cfg.minNetBrlDay||0),shouldRun=windowOk&&profitOk;
    if(!shouldRun&&state.processRunning&&state.desired==='running'){
      const why=!windowOk?`Fora da janela ${cfg.start}–${cfg.stop}.`:`Lucro estimado ${net?.toFixed(2)} abaixo do limite ${Number(cfg.minNetBrlDay||0).toFixed(2)}.`;
      this.controller.pause('scheduler');this.pausedByScheduler=true;this.record('PAUSE',why,{windowOk,profitOk,netBrlDay:net});
    } else if(shouldRun&&this.pausedByScheduler&&!state.processRunning&&state.desired==='paused'){
      await this.controller.resume(this.getContext(),'scheduler');this.pausedByScheduler=false;this.record('RESUME','Janela/critério de rentabilidade voltou a permitir mineração.',{windowOk,profitOk,netBrlDay:net});
    }
    return this.snapshot();
  }
  userStopped(){this.pausedByScheduler=false;}
}
module.exports={SchedulerEngine,insideWindow,minutesOfDay};

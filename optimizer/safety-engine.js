'use strict';

class SafetyEngine {
  constructor(settings={}){this.settings=settings;}
  update(settings){this.settings=settings;}
  validateCandidate(config,hardware){
    const errors=[];
    const threads=Number(config.threads||0);
    const max=Number(hardware?.logicalThreads||1);
    if(!(threads>=1&&threads<=max))errors.push(`threads fora do limite 1..${max}`);
    if(![0,1,2,3,4,5].includes(Number(config.priority)))errors.push('prioridade fora do intervalo 0..5');
    if(!['auto','fast','light'].includes(config.randomxMode||'fast'))errors.push('RandomX mode inválido');
    if(config.hugePages===false&&this.settings.requireHugePages)errors.push('perfil exige Huge Pages');
    return {ok:errors.length===0,errors};
  }
  runtimeAction(sample){
    const warning=Number(this.settings.thermalWarningC||75);
    const critical=Number(this.settings.thermalCriticalC||85);
    const temp=Number(sample?.temperatureC);
    if(Number.isFinite(temp)&&temp>=critical)return {action:'pause',reason:`temperatura ${temp.toFixed(1)}°C >= limite crítico ${critical}°C`};
    if(Number.isFinite(temp)&&temp>=warning)return {action:'reduce',reason:`temperatura ${temp.toFixed(1)}°C >= alerta ${warning}°C`};
    const total=Number(sample?.accepted||0)+Number(sample?.rejected||0);
    const rr=total>0?Number(sample.rejected||0)/total:0;
    if(total>=10&&rr>Number(this.settings.maxRejectRate||0.05))return {action:'rollback',reason:`reject rate ${(rr*100).toFixed(1)}% acima do limite`};
    return {action:'keep',reason:'dentro dos limites configurados'};
  }
  compare(baseline,candidate){
    const bh=Number(baseline.hashrate||0), ch=Number(candidate.hashrate||0);
    const minRatio=Number(this.settings.minHashrateRatio||0.82);
    if(bh>0&&ch<bh*minRatio)return {safe:false,reason:`hashrate caiu mais de ${((1-minRatio)*100).toFixed(0)}%`};
    if(Number(candidate.rejectRate||0)>Number(this.settings.maxRejectRate||0.05))return {safe:false,reason:'taxa de rejeição acima do limite'};
    const critical=Number(this.settings.thermalCriticalC||85);
    if(Number.isFinite(Number(candidate.temperatureC))&&Number(candidate.temperatureC)>=critical)return {safe:false,reason:'temperatura crítica atingida'};
    if(Number(candidate.crashed||0))return {safe:false,reason:'candidato causou crash'};
    return {safe:true,reason:'candidato permaneceu dentro dos limites'};
  }
}
module.exports={SafetyEngine};

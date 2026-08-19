'use strict';

const S=require('./statistics');

class AnomalyDetector{
  inspect(current,history=[]){
    const alerts=[];
    const h=history.slice(-90);
    const hashes=h.map(x=>x.local_hashrate).filter(Number.isFinite);
    const powers=h.map(x=>x.power_w).filter(Number.isFinite);
    const temps=h.map(x=>x.temperature_c).filter(Number.isFinite);
    const rejectRate=Number(current.accepted)+Number(current.rejected)>0?Number(current.rejected)/(Number(current.accepted)+Number(current.rejected)):0;
    if(hashes.length>=15&&Number(current.localHashrate)>0){
      const z=S.robustZ(Number(current.localHashrate),hashes);
      const med=S.median(hashes);
      if(z<-3.5||Number(current.localHashrate)<med*.8)alerts.push({severity:'warning',code:'hashrate-drop',message:`Hashrate caiu ${((1-Number(current.localHashrate)/med)*100).toFixed(1)}% contra a mediana recente.`,evidence:{z,median:med,current:Number(current.localHashrate)}});
    }
    if(powers.length>=15&&Number(current.powerW)>0){const z=S.robustZ(Number(current.powerW),powers);if(z>4)alerts.push({severity:'warning',code:'power-spike',message:'Consumo acima do padrão recente.',evidence:{z,current:Number(current.powerW),median:S.median(powers)}});}
    if(temps.length>=15&&Number.isFinite(Number(current.temperatureC))){const z=S.robustZ(Number(current.temperatureC),temps);if(z>4)alerts.push({severity:'warning',code:'temperature-spike',message:'Temperatura subiu de forma anormal em relação ao histórico.',evidence:{z,current:Number(current.temperatureC),median:S.median(temps)}});}
    if(rejectRate>.05)alerts.push({severity:'warning',code:'reject-rate',message:`Taxa de rejeição ${(rejectRate*100).toFixed(1)}% está elevada.`,evidence:{rejectRate}});
    if(current.processRunning&&!current.apiConnected)alerts.push({severity:'warning',code:'xmrig-api',message:'Processo do XMRig existe, mas a API local não respondeu.',evidence:{}});
    return alerts;
  }
}
module.exports={AnomalyDetector};

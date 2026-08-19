'use strict';
class PowerProvider{
  constructor(settingsProvider){this.settingsProvider=settingsProvider;}
  read({mining=false,gpuActive=false}={}){const s=this.settingsProvider(),p=s.power||{};if(!mining)return {watts:0,source:'not-mining',real:false,label:'minerador parado'};
    if(p.mode==='manual-wattmeter'&&Number(p.measuredMiningWatts)>0)return {watts:Number(p.measuredMiningWatts),idleWatts:Number(p.idleWatts||0),costMode:p.costMode||'full',source:'manual-wattmeter',real:true,label:'W reais informados pelo usuário'};
    const watts=Number(p.estimatedBaseWatts||30)+Number(p.estimatedCpuWatts||75)+(gpuActive?47:0);return {watts,idleWatts:Number(p.idleWatts||0),costMode:p.costMode||'full',source:'hardware-profile-estimate',real:false,label:'W estimados'};}
}
module.exports={PowerProvider};

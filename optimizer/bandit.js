'use strict';

class UCB1Bandit {
  constructor(c=1.2){this.c=Number(c)||1.2;}
  select(arms){
    const rows=(arms||[]).filter(a=>a&&a.id);
    if(!rows.length)return null;
    const untried=rows.find(a=>Number(a.count||0)===0);
    if(untried)return {...untried,ucb:Infinity,reason:'perfil ainda não observado'};
    const total=Math.max(1,rows.reduce((s,a)=>s+Number(a.count||0),0));
    return rows.map(a=>{
      const n=Math.max(1,Number(a.count||0));
      const mean=Number(a.meanReward||0);
      const ucb=mean+this.c*Math.sqrt(Math.log(total)/n);
      return {...a,ucb};
    }).sort((a,b)=>b.ucb-a.ucb)[0];
  }
}
module.exports={UCB1Bandit};

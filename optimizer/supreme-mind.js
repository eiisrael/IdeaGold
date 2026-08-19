'use strict';

const EventEmitter=require('events');
const {GaussianProcessOptimizer,generateSafeCandidates}=require('./bayesian-optimizer');
const {objectiveValue,explain}=require('./scoring');
const {LocalMLPredictor}=require('./ml-predictor');

class SupremeMind extends EventEmitter{
  constructor({db,benchmark,safety,configManager,controller,getContext,getCurrent,ml=null,logger=null}){
    super();Object.assign(this,{db,benchmark,safety,configManager,controller,getContext,getCurrent,logger});
    this.ml=ml||new LocalMLPredictor();
    this.state={enabled:false,objective:'balanced',status:'idle',experiments:0,best:null,current:null,confidence:0,startedAt:null,lastDecision:null};
    this.cancelled=false;this.lastThermalAction=0;
  }
  snapshot(){const ml=this.ml.status();return {...this.state,benchmark:this.benchmark.status(),ml,classification:{rules:'Rule Engine',statistics:'Statistical Model',optimizer:'Bayesian Optimizer',bandit:'UCB1 disponível após perfis suficientes',machineLearning:ml.ready?`Ridge Regression local ativa • ${ml.unique} benchmarks únicos`:`Ridge Regression local coletando dados • faltam ${ml.needed}`}};}
  setEnabled(value){this.state.enabled=Boolean(value);if(!this.state.enabled&&this.state.status==='learning')this.cancel();this.logger?.info('supreme','toggle',`Supreme Mind ${this.state.enabled?'ativado':'desativado'}.`);this.emit('state',this.snapshot());return this.snapshot();}
  setObjective(value){const allowed=['performance','efficiency','profit','balanced','silent','manual'];if(!allowed.includes(value))throw new Error('Objetivo inválido.');this.state.objective=value;this.logger?.info('supreme','objective',`Objetivo alterado para ${value}.`);this.emit('state',this.snapshot());return this.snapshot();}
  cancel(){this.cancelled=true;this.benchmark.cancel();this.state.status='stopping';this.logger?.warn('supreme','cancel','Encerramento do autotuning solicitado.');this.emit('state',this.snapshot());}
  async observe(sample){
    if(!this.state.enabled||!sample)return;const settings=this.getContext().settings;this.safety.update(settings);const action=this.safety.runtimeAction({temperatureC:sample.hardware?.temperatureC,accepted:sample.session?.accepted,rejected:sample.session?.rejected});
    if(action.action==='pause'&&sample.miner?.processRunning&&Date.now()-this.lastThermalAction>60000){this.lastThermalAction=Date.now();this.controller.pause('thermal-safety');this.logDecision({action:'PAUSAR',reason:action.reason,before:sample.miner?.profile,after:null,confidence:1,result:'SAFETY'});}
  }
  logDecision(row){const full={...row,engine:'Supreme Mind',objective:this.state.objective,ts:Date.now()};this.db.addDecision(full);this.state.lastDecision=full;this.logger?.info('supreme','decision',`${full.action}: ${full.reason}`,{result:full.result,confidence:full.confidence,before:full.before,after:full.after});this.emit('decision',full);return full;}
  benchmarkRows(){return this.db.listBenchmarks(2000).filter(r=>r.hardware_fingerprint===this.getContext().hardware.fingerprint&&r.status==='complete').map(r=>({...r,config:JSON.parse(r.config_json||'{}'),value:Number(r.score),hashrate:Number(r.hashrate),powerW:Number(r.power_w),temperatureC:r.temperature_c==null?null:Number(r.temperature_c),efficiencyHW:r.efficiency_hw==null?null:Number(r.efficiency_hw),profitBrlDay:r.profit_brl_day==null?null:Number(r.profit_brl_day),stability:Number(r.stability),confidence:Number(r.confidence)}));}
  chooseCandidate({gp,observations,candidates,index}){
    const history=this.benchmarkRows().map(r=>({...r,value:objectiveValue(this.state.objective,r)}));this.ml.fit(history);
    const tested=new Set(observations.map(o=>JSON.stringify(o.config)));const remaining=candidates.filter(c=>!tested.has(JSON.stringify(c)));if(!remaining.length)return null;
    const mlRank=this.ml.rank(remaining),gpSuggestion=gp.suggest(observations,remaining);
    if(this.ml.status().ready&&mlRank.length&&index%2===1)return{config:mlRank[0].config,prediction:mlRank[0].prediction,source:'local-ml-ridge'};
    return gpSuggestion?{...gpSuggestion,source:'bayesian-gp'}:(mlRank[0]?{config:mlRank[0].config,prediction:mlRank[0].prediction,source:'local-ml-ridge'}:null);
  }
  async autotune(options={}){
    if(this.state.objective==='manual')throw new Error('Modo Manual não altera configuração automaticamente.');if(this.state.status==='learning')throw new Error('Supreme Mind já está em autotuning.');const ctx=this.getContext();if(!ctx.settings.wallet)throw new Error('Configure a carteira antes do autotuning.');
    this.cancelled=false;this.state.status='learning';this.state.startedAt=Date.now();this.state.experiments=0;this.state.error=null;this.logger?.info('supreme','autotune-start','Autotuning iniciado.',{objective:this.state.objective});this.emit('state',this.snapshot());
    const original={...(ctx.profile||{})};let baseline=null,best=null;
    try{
      const warmupSec=Math.max(10,Number(options.warmupSec||ctx.settings.benchmarkWarmupSec||20)),sampleSec=Math.max(30,Number(options.sampleSec||ctx.settings.benchmarkSampleSec||60));baseline=await this.benchmark.runCandidate(original,{objective:this.state.objective,warmupSec,sampleSec,label:'baseline'});this.state.experiments++;best=baseline;
      const maxExperiments=Math.max(1,Math.min(12,Number(options.maxExperiments||ctx.settings.maxAutotuneExperiments||4))),candidates=generateSafeCandidates({logicalThreads:ctx.hardware.logicalThreads,current:original}).map(c=>({...c,gpuMode:'off'})).filter(c=>this.safety.validateCandidate(c,ctx.hardware).ok),historical=this.benchmarkRows().map(r=>({config:r.config,value:objectiveValue(this.state.objective,r)})),observations=[...historical,{config:original,value:objectiveValue(this.state.objective,baseline)}],gp=new GaussianProcessOptimizer({threads:{min:1,max:ctx.hardware.logicalThreads}});
      for(let i=0;i<maxExperiments&&!this.cancelled;i++){
        const suggestion=this.chooseCandidate({gp,observations,candidates,index:i}),config=suggestion?.config;if(!config)break;this.state.current={config,index:i+1,total:maxExperiments,prediction:suggestion?.prediction||null,expectedImprovement:suggestion?.ei||null,source:suggestion?.source};this.logger?.info('supreme','candidate',`Testando candidato ${i+1}/${maxExperiments}.`,this.state.current);this.emit('state',this.snapshot());let result;
        try{result=await this.benchmark.runCandidate(config,{objective:this.state.objective,warmupSec,sampleSec,label:`candidate-${i+1}`,baseline:best});}catch(error){this.logDecision({action:'REJEITAR CANDIDATO',reason:error.message,before:best?.config,after:config,confidence:1,result:'ROLLBACK'});continue;}
        this.state.experiments++;observations.push({config,value:objectiveValue(this.state.objective,result)});const beforeScore=objectiveValue(this.state.objective,best),afterScore=objectiveValue(this.state.objective,result),requiredGain=Math.max(1e-12,Math.abs(beforeScore)*.005);
        if(result.safe&&afterScore>beforeScore+requiredGain){const previousBest=best,delta=explain(this.state.objective,previousBest,result);best=result;this.logDecision({action:'MANTER CONFIGURAÇÃO',reason:'Candidato superou o melhor perfil medido e passou nas regras de segurança.',before:previousBest?.config,after:result.config||config,observed:delta,confidence:result.confidence,result:'WIN'});}else{this.logDecision({action:'REVERTER',reason:result.safe?'Ganho não superou a margem mínima para justificar mudança.':result.safetyReason,before:best?.config,after:config,observed:result.comparison,confidence:result.confidence,result:'LOSS'});await this.controller.restart({...this.getContext(),profile:best.config},'supreme-mind-loss-rollback');}
      }
      if(!best)throw new Error('Nenhum benchmark válido foi concluído.');const finalCtx=this.getContext();await this.controller.restart({...finalCtx,profile:best.config},this.cancelled?'supreme-mind-stop-best':'supreme-mind-winner');const built=this.configManager.build({wallet:finalCtx.settings.wallet,workerName:finalCtx.settings.workerName,pool:finalCtx.pool,profile:best.config});this.configManager.saveSafe(built.config,{source:'Supreme Mind',objective:this.state.objective,confidence:best.confidence});const profileId=`best-${this.state.objective}`;this.db.saveProfile({id:profileId,name:`Best ${this.state.objective}`,kind:'learned',objective:this.state.objective,config:best.config,score:objectiveValue(this.state.objective,best),confidence:best.confidence,safe:true});this.state.best=best;this.state.confidence=best.confidence;this.state.status=this.cancelled?'cancelled':'ready';this.state.current=null;this.ml.fit(this.benchmarkRows().map(r=>({...r,value:objectiveValue(this.state.objective,r)})));this.logDecision({action:this.cancelled?'PARAR NO MELHOR PERFIL':'APLICAR VENCEDOR',reason:this.cancelled?'Autotuning interrompido; melhor configuração estável foi restaurada.':'Melhor configuração medida aplicada e salva como Last Known Good.',before:original,after:best.config,confidence:best.confidence,result:this.cancelled?'SAFE':'APPLIED'});return this.snapshot();
    }catch(error){this.state.status=this.cancelled?'cancelled':'error';this.state.error=error.message;try{await this.controller.restart({...this.getContext(),profile:best?.config||original},'supreme-mind-rollback');}catch{}this.logDecision({action:'ROLLBACK',reason:`Autotuning interrompido: ${error.message}`,before:this.state.current?.config,after:best?.config||original,confidence:1,result:'SAFE'});throw error;}finally{this.logger?.info('supreme','autotune-end','Autotuning finalizado.',{status:this.state.status,experiments:this.state.experiments});this.emit('state',this.snapshot());}
  }
}
module.exports={SupremeMind};

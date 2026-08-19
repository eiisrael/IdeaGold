'use strict';

const {objectiveValue}=require('./scoring');

class GpuTuner{
  constructor({controller,benchmark,getContext,getTelemetry,logger=null,db=null}){Object.assign(this,{controller,benchmark,getContext,getTelemetry,logger,db});this.running=false;this.last=null;}
  async probe(){const hardware=this.getContext().hardware||{},declared=hardware.gpu||[],opencl=await this.controller.probeOpenCL();const result={ts:Date.now(),hardware:declared,opencl,compatible:Boolean(opencl.available&&opencl.amdDetected),note:opencl.available&&opencl.amdDetected?'AMD/OpenCL detectado. Isso prova capacidade técnica, não rentabilidade.':'Backend AMD/OpenCL não foi confirmado; GPU continuará desligada.'};this.last={type:'probe',...result};return result;}
  async benchmarkGpu({objective=null,warmupSec=null,sampleSec=null}={}){
    if(this.running||this.benchmark.running)throw new Error('Já existe benchmark em andamento.');this.running=true;
    const ctx=this.getContext(),obj=objective||ctx.settings.objective||'balanced',original={...(ctx.profile||{})},off={...original,gpuMode:'off'},on={...original,gpuMode:'on',openclPlatform:original.openclPlatform||'AMD'};
    this.logger?.info('gpu','benchmark-start','Benchmark A/B CPU versus CPU+OpenCL iniciado.',{objective:obj,original});
    try{
      const probe=await this.probe();if(!probe.compatible)throw new Error('OpenCL AMD não foi confirmado pelo XMRig; teste abortado sem alterar perfil permanente.');
      const warm=Math.max(10,Number(warmupSec||ctx.settings.benchmarkWarmupSec||20)),sample=Math.max(30,Number(sampleSec||ctx.settings.benchmarkSampleSec||60));
      const baseline=await this.benchmark.runCandidate(off,{objective:obj,warmupSec:warm,sampleSec:sample,label:'gpu-baseline-cpu'});
      const candidate=await this.benchmark.runCandidate(on,{objective:obj,warmupSec:warm,sampleSec:sample,label:'gpu-opencl-candidate',baseline});
      const live=this.getTelemetry(),powerKind=live?.power?.kind||'estimated',before=objectiveValue(obj,baseline),after=objectiveValue(obj,candidate),minGain=Math.max(1e-12,Math.abs(before)*.01);
      let keep=candidate.safe&&after>before+minGain,reason=keep?'GPU/OpenCL superou o baseline no objetivo selecionado.':'GPU/OpenCL não superou o baseline com margem suficiente.';
      if(['profit','efficiency'].includes(obj)&&!['measured','hybrid'].includes(powerKind)){keep=false;reason='Para otimizar lucro/eficiência com GPU é necessário wattímetro ou telemetria de componentes; potência apenas estimada não autoriza decisão automática.';}
      if(obj==='performance'&&candidate.hashrate<baseline.hashrate*1.03){keep=false;reason='Ganho de hashrate menor que 3%; não vale a complexidade/risco adicional.';}
      const winningProfile=keep?on:off;
      await this.controller.restart({...ctx,profile:winningProfile},keep?'gpu-winner':'gpu-rollback');
      const result={ts:Date.now(),objective:obj,probe,baseline,candidate,powerKind,keep,reason,winningProfile};this.last={type:'benchmark',...result};
      this.db?.addDecision({engine:'GPU Tuner',objective:obj,action:keep?'ATIVAR GPU':'MANTER CPU',reason,before:off,after:winningProfile,observed:{baseline:{hashrate:baseline.hashrate,powerW:baseline.powerW,score:before},candidate:{hashrate:candidate.hashrate,powerW:candidate.powerW,score:after}},confidence:Math.min(baseline.confidence||0,candidate.confidence||0),result:keep?'WIN':'ROLLBACK'});
      this.logger?.info('gpu','benchmark-end',reason,{keep,powerKind,baselineHash:baseline.hashrate,candidateHash:candidate.hashrate,baselinePower:baseline.powerW,candidatePower:candidate.powerW});return result;
    }catch(error){try{await this.controller.restart({...ctx,profile:off},'gpu-error-rollback');}catch{}this.logger?.error('gpu','benchmark-error','Benchmark GPU falhou; CPU-only restaurado.',error);throw error;}finally{this.running=false;}
  }
  snapshot(){return{running:this.running,last:this.last};}
}
module.exports={GpuTuner};

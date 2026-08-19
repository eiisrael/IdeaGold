'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const net=require('net');
const {spawn,spawnSync}=require('child_process');

function alive(pid){if(!pid)return false;try{process.kill(Number(pid),0);return true;}catch{return false;}}
function tcp(host,port,timeout=1000){return new Promise(resolve=>{const s=net.createConnection({host,port}),done=ok=>{try{s.destroy();}catch{}resolve(ok)};s.setTimeout(timeout);s.once('connect',()=>done(true));s.once('error',()=>done(false));s.once('timeout',()=>done(false));});}
function find(dir,name){if(!fs.existsSync(dir))return null;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isFile()&&e.name.toLowerCase()===name.toLowerCase())return f;if(e.isDirectory()){const x=find(f,name);if(x)return x;}}return null;}

class P2PoolManager{
  constructor(root,logger=null){this.root=root;this.logger=logger;this.dir=path.join(root,'runtime','p2pool');this.metaFile=path.join(this.dir,'meta.json');this.stateFile=path.join(this.dir,'state.json');this.dataApi=path.join(this.dir,'data-api');this.logFile=path.join(this.dir,'p2pool.log');this.child=null;fs.mkdirSync(this.dir,{recursive:true});fs.mkdirSync(this.dataApi,{recursive:true});}
  read(file,f={}){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return f;}}
  write(file,v){fs.writeFileSync(file,JSON.stringify(v,null,2));}
  async fetchBuffer(url,timeout=120000){const r=await fetch(url,{redirect:'follow',headers:{accept:'application/octet-stream','user-agent':'IdeaGold/5.1'},signal:AbortSignal.timeout(timeout)});if(!r.ok)throw new Error(`HTTP ${r.status} em ${url}`);return Buffer.from(await r.arrayBuffer());}
  async release(){const r=await fetch('https://api.github.com/repos/SChernykh/p2pool/releases/latest',{headers:{accept:'application/vnd.github+json','user-agent':'IdeaGold/5.1'},signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error(`GitHub P2Pool release HTTP ${r.status}`);const d=await r.json();return{tag:d.tag_name,name:d.name,assets:(d.assets||[]).map(a=>({name:a.name,url:a.browser_download_url,size:a.size}))};}
  async install(){
    if(process.platform!=='win32'||process.arch!=='x64')throw new Error('Instalador assistido do P2Pool V5.1 requer Windows x64.');
    const rel=await this.release(),asset=rel.assets.find(a=>/windows.*x64.*\.zip$/i.test(a.name))||rel.assets.find(a=>/win.*64.*\.zip$/i.test(a.name)),sums=rel.assets.find(a=>/^sha256sums\.txt\.asc$/i.test(a.name));
    if(!asset)throw new Error(`Release ${rel.tag} não contém ZIP Windows x64 reconhecido.`);if(!sums)throw new Error(`Release ${rel.tag} não contém sha256sums.txt.asc; instalação recusada.`);
    this.logger?.info('p2pool','install-start','Baixando P2Pool da release oficial.',{tag:rel.tag,asset:asset.name});
    const [zipBuf,sumBuf]=await Promise.all([this.fetchBuffer(asset.url),this.fetchBuffer(sums.url,30000)]),sumText=sumBuf.toString('utf8'),escaped=asset.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),m=sumText.match(new RegExp(`([a-fA-F0-9]{64})\\s+\\*?${escaped}(?:\\r?\\n|$)`));
    if(!m)throw new Error(`Checksum de ${asset.name} não encontrado na lista oficial assinada.`);const expected=m[1].toLowerCase(),actual=crypto.createHash('sha256').update(zipBuf).digest('hex');if(actual!==expected)throw new Error('SHA-256 do P2Pool não confere com a lista da release oficial. Nada foi extraído.');
    const zip=path.join(this.dir,asset.name),versionDir=path.join(this.dir,rel.tag);fs.writeFileSync(zip,zipBuf);fs.rmSync(versionDir,{recursive:true,force:true});fs.mkdirSync(versionDir,{recursive:true});const q=s=>String(s).replaceAll("'","''"),ex=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-Command',`Expand-Archive -LiteralPath '${q(zip)}' -DestinationPath '${q(versionDir)}' -Force`],{encoding:'utf8',windowsHide:true});fs.rmSync(zip,{force:true});if(ex.status!==0)throw new Error(`Falha ao extrair P2Pool: ${ex.stderr||ex.stdout}`);const exe=find(versionDir,'p2pool.exe');if(!exe)throw new Error('p2pool.exe não foi encontrado após extração.');
    const meta={tag:rel.tag,asset:asset.name,exe,sha256:actual,verifiedChecksum:true,checksumSource:'sha256sums.txt.asc da mesma release oficial',signatureIndependentlyVerified:false,installedAt:Date.now()};this.write(this.metaFile,meta);this.logger?.info('p2pool','install-ok','P2Pool instalado com SHA-256 conferido.',meta);return meta;
  }
  async status(){const meta=this.read(this.metaFile,{}),state=this.read(this.stateFile,{}),stratum=await tcp('127.0.0.1',3333),rpc=await tcp('127.0.0.1',18081),zmq=await tcp('127.0.0.1',18083);return{installed:Boolean(meta.exe&&fs.existsSync(meta.exe)),meta,processRunning:alive(state.pid),pid:alive(state.pid)?state.pid:null,stratumOnline:stratum,monerodRpc:rpc,monerodZmq:zmq,dataApi:this.dataApi,readyToStart:Boolean(meta.exe&&fs.existsSync(meta.exe)&&rpc&&zmq),note:!rpc||!zmq?'P2Pool instalado pode existir, mas monerod local precisa estar com RPC 18081 e ZMQ 18083.':stratum?'P2Pool local/Stratum online.':'Pronto para iniciar P2Pool local.'};}
  async start({wallet,sidechain='mini'}={}){
    if(!wallet)throw new Error('Carteira pública XMR é obrigatória para iniciar P2Pool.');const st=await this.status();if(st.processRunning)return st;if(!st.installed)throw new Error('Instale P2Pool primeiro.');if(!st.monerodRpc||!st.monerodZmq)throw new Error('monerod local não está pronto em RPC 18081 + ZMQ 18083. O IdeaGold não inicia um nó incompleto.');
    const meta=this.read(this.metaFile,{}),out=fs.openSync(this.logFile,'a'),p2pPort=sidechain==='mini'?37888:37889,args=['--host','127.0.0.1','--wallet',wallet,'--stratum','127.0.0.1:3333','--p2p',`127.0.0.1:${p2pPort}`,'--data-api',this.dataApi,'--local-api','--no-upnp','--log-file',this.logFile];if(sidechain==='mini')args.push('--mini');
    this.child=spawn(meta.exe,args,{cwd:path.dirname(meta.exe),stdio:['ignore',out,out],windowsHide:true,detached:false});const state={pid:this.child.pid,startedAt:Date.now(),sidechain,desired:'running'};this.write(this.stateFile,state);this.logger?.info('p2pool','start','P2Pool local iniciado, sem abrir firewall/UPnP.',{pid:state.pid,sidechain,p2pListen:`127.0.0.1:${p2pPort}`,stratum:'127.0.0.1:3333'});this.child.on('exit',(code,signal)=>{const s=this.read(this.stateFile,{});s.pid=null;s.exitCode=code;s.exitSignal=signal;s.lastExitAt=Date.now();this.write(this.stateFile,s);this.logger?.[s.desired==='running'?'error':'info']('p2pool','exit','P2Pool encerrou.',{code,signal,desired:s.desired});this.child=null;});return this.status();
  }
  stop(){const s=this.read(this.stateFile,{});s.desired='stopped';if(alive(s.pid)){if(process.platform==='win32')spawnSync('taskkill',['/PID',String(s.pid),'/T','/F'],{windowsHide:true});else try{process.kill(Number(s.pid),'SIGTERM')}catch{}}s.pid=null;s.stoppedAt=Date.now();this.write(this.stateFile,s);this.logger?.info('p2pool','stop','P2Pool local parado pelo usuário.');return s;}
}
module.exports={P2PoolManager};

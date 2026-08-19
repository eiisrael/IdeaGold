'use strict';

const fs=require('fs');
const path=require('path');
const {spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..');
const dirs=['backend','database','miner','optimizer','providers','telemetry','scripts'];
const files=[];
function walk(dir){if(!fs.existsSync(dir))return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(e.isFile()&&p.endsWith('.js')&&!p.endsWith('check.js'))files.push(p);}}
for(const d of dirs)walk(path.join(root,d));
files.push(path.join(root,'worker-agent.js'));
let failed=0;
for(const file of files){if(!fs.existsSync(file))continue;const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(r.status!==0){failed++;console.error(`FAIL ${path.relative(root,file)}\n${r.stderr||r.stdout}`);}else console.log(`OK   ${path.relative(root,file)}`);}
const html=path.join(root,'frontend','index.html');
const app=path.join(root,'frontend','app.js');
for(const f of [html,app,path.join(root,'frontend','styles.css')])if(!fs.existsSync(f)){console.error(`FAIL missing ${path.relative(root,f)}`);failed++;}
if(failed){console.error(`\n${failed} validação(ões) falharam.`);process.exit(1);}console.log(`\nIdeaGold syntax check: ${files.length} JS files OK`);

'use strict';

const fs=require('fs');
const path=require('path');
const {spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..');
const dirs=['backend','database','miner','optimizer','providers','telemetry','observability','scripts'];
const files=[];
function walk(dir){if(!fs.existsSync(dir))return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(e.isFile()&&p.endsWith('.js')&&!p.endsWith('check.js'))files.push(p);}}
for(const d of dirs)walk(path.join(root,d));
files.push(path.join(root,'worker-agent.js'));
files.push(path.join(root,'frontend','app.js'));
files.push(path.join(root,'frontend','v51.js'));
let failed=0;
for(const file of files){if(!fs.existsSync(file)){failed++;console.error(`FAIL missing ${path.relative(root,file)}`);continue;}const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(r.status!==0){failed++;console.error(`FAIL ${path.relative(root,file)}\n${r.stderr||r.stdout}`);}else console.log(`OK   ${path.relative(root,file)}`);}
for(const f of ['frontend/index.html','frontend/styles.css','frontend/v51.css'].map(x=>path.join(root,x)))if(!fs.existsSync(f)){console.error(`FAIL missing ${path.relative(root,f)}`);failed++;}
if(failed){console.error(`\n${failed} validação(ões) falharam.`);process.exit(1);}console.log(`\nIdeaGold syntax check: ${files.length} JS files OK`);

'use strict';

const { spawn } = require('child_process');
const path = require('path');

const PORT = 18081;
const HOST = '127.0.0.1';
const root = path.resolve(__dirname, '..');
const child = spawn(process.execPath, [path.join(root, 'backend', 'server.js')], {
  cwd: root,
  env: { ...process.env, HOST, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
});

let output = '';
child.stdout.on('data', d => { output += d.toString(); });
child.stderr.on('data', d => { output += d.toString(); });

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function stop() {
  if (child.exitCode == null) child.kill();
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    sleep(3000)
  ]);
}

(async () => {
  const deadline = Date.now() + 20000;
  let lastError = null;
  try {
    while (Date.now() < deadline) {
      if (child.exitCode != null) throw new Error(`Backend encerrou antes do health check (code ${child.exitCode}).\n${output}`);
      try {
        const res = await fetch(`http://${HOST}:${PORT}/api/health`, { signal: AbortSignal.timeout(1500) });
        if (res.ok) {
          const body = await res.json();
          if (body?.ok === true && body?.version === '5.0.0') {
            console.log(`OK smoke backend: ${body.name} ${body.version}`);
            return;
          }
          lastError = new Error(`Health respondeu conteúdo inesperado: ${JSON.stringify(body)}`);
        } else lastError = new Error(`Health HTTP ${res.status}`);
      } catch (error) { lastError = error; }
      await sleep(500);
    }
    throw new Error(`Backend não ficou saudável em 20s: ${lastError?.message || 'sem resposta'}\n${output}`);
  } finally {
    await stop();
  }
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});

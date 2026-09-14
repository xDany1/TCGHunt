import { spawn } from 'node:child_process';
import { openSync, closeSync, writeFileSync, readFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
const finalValidation = process.argv.includes('--m4-5');
const output = resolve(finalValidation ? 'outputs/M4_5_E2E' : 'outputs');
mkdirSync(output, { recursive: true }); mkdirSync('work', { recursive: true });
const profile = finalValidation ? resolve(mkdtempSync('work/m4-5-e2e-')) : resolve('work/m4-e2e-profile');
const env = { ...process.env, PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`, ASTRA_ALTO_DATA_DIR: profile, ASTRA_M4_OUTPUT: output };
delete env.SHOPIFY_LIVE_VALIDATION_ENABLED; delete env.SHOPIFY_STORE_DOMAIN;
if (process.argv.includes('--software')) env.ASTRA_SOFTWARE_RENDERING = '1'; else delete env.ASTRA_SOFTWARE_RENDERING;
for (let pass = 1; pass <= 2; pass++) {
  env.ASTRA_M4_RESULT = join(output, `M4_DESKTOP_SMOKE_${pass}.json`);
  writeFileSync(env.ASTRA_M4_RESULT, JSON.stringify({ status: 'PARTIAL', rendererLoaded: false, reason: 'PROCESS_NOT_COMPLETED', externalRequests: 0 }, null, 2));
  const stdout = openSync(join(output, `M4_DESKTOP_STDOUT_${pass}.log`), 'w'); const stderr = openSync(join(output, `M4_DESKTOP_STDERR_${pass}.log`), 'w');
  const started = Date.now();
  const child = spawn(resolve('work/m4-test-build/Astra Alto/AstraAlto.exe'), [], { env, windowsHide: true, stdio: ['ignore', stdout, stderr] });
  const timeout = setTimeout(() => child.kill(), 60000);
  const exitCode = await new Promise((done, reject) => { child.on('error', reject); child.on('exit', done); }); clearTimeout(timeout); closeSync(stdout); closeSync(stderr);
  writeFileSync(join(output, `M4_DESKTOP_PROCESS_${pass}.json`), JSON.stringify({ pass, exitCode, elapsedMs: Date.now() - started, toolchainInPath: false, profile, fixtureOnly: true }, null, 2));
  if (exitCode !== 0) { const incomplete = JSON.parse(readFileSync(env.ASTRA_M4_RESULT, 'utf8')); writeFileSync(env.ASTRA_M4_RESULT, JSON.stringify({ ...incomplete, status: 'PARTIAL', processExitCode: exitCode }, null, 2)); }
  if (exitCode !== 0) { console.error(`Desktop smoke ${pass} failed; inspect its JSON result and local log.`); process.exitCode = 1; break; }
}

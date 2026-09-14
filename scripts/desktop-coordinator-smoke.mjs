import { createPackageWithOptions } from '@electron/asar';
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync, openSync, closeSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url); const live = process.argv.includes('--live');
mkdirSync('work/m4-utility', { recursive: true }); const root = mkdtempSync(resolve('work/m4-utility/run-')); const source = join(root, 'app'); mkdirSync(source);
const from = resolve(live ? 'work/m4-build/app' : 'work/m4-test-build/app');
const hashes = {};
for (const name of ['coordinator.cjs', 'adapter-worker.cjs']) { cpSync(join(from, name), join(source, name)); hashes[name] = createHash('sha256').update(readFileSync(join(source, name))).digest('hex'); }
cpSync('scripts/desktop-coordinator-smoke.cjs', join(source, 'main.cjs')); writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'm4-utility-experiment', main: 'main.cjs' }));
const target = join(root, 'package'); cpSync(join(require.resolve('electron/package.json'), '..', 'dist'), target, { recursive: true });
await createPackageWithOptions(source, join(target, 'resources/app.asar'), { unpack: '{coordinator,adapter-worker}.cjs' });
const result = resolve(`outputs/M4_PACKAGED_COORDINATOR_${live ? 'LIVE' : 'FIXTURE'}.json`);
writeFileSync(result, JSON.stringify({ status: 'PARTIAL', runId: root, reason: 'PROCESS_NOT_COMPLETED', live, rendererTested: false }, null, 2));
const output = openSync(join(root, 'stdout.log'), 'w'); const error = openSync(join(root, 'stderr.log'), 'w');
const env = { ...process.env, PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`, ASTRA_ALTO_DATA_DIR: join(root, 'profile'), ASTRA_M4_RESULT: result, ASTRA_M4_LIVE: live ? '1' : '0', ASTRA_M4_RUN_ID: root };
const processHandle = spawn(join(target, 'electron.exe'), [], { env, windowsHide: true, stdio: ['ignore', output, error] });
const timeout = setTimeout(() => processHandle.kill(), 60000);
const exitCode = await new Promise((done, reject) => { processHandle.on('exit', done); processHandle.on('error', reject); }); clearTimeout(timeout); closeSync(output); closeSync(error);
if (exitCode !== 0) { const incomplete = JSON.parse(readFileSync(result, 'utf8')); writeFileSync(result, JSON.stringify({ ...incomplete, status: 'PARTIAL', processExitCode: exitCode }, null, 2)); }
writeFileSync(resolve(`outputs/M4_PACKAGED_COORDINATOR_${live ? 'LIVE' : 'FIXTURE'}_PROCESS.json`), JSON.stringify({ exitCode, toolchainInPath: false, sourceBundles: hashes, profile: env.ASTRA_ALTO_DATA_DIR, harnessDirectory: root }, null, 2));
console.log(JSON.stringify({ exitCode, result })); process.exitCode = exitCode === 0 ? 0 : 1;

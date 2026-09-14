// Bounded read-only Windows sampling; no process control, debug ports or policy changes.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const [directory, output, phase = 'steady-state-unconfirmed', seconds = '30'] = process.argv.slice(2);
const duration = Number(seconds);
if (process.platform !== 'win32' || !directory || !output || !/^[a-z-]{1,40}$/.test(phase) || !Number.isInteger(duration) || duration < 5 || duration > 120) throw new Error('Usage: node scripts/m4-process-measurement.mjs PACKAGE_DIRECTORY OUTPUT_JSON [phase-label] [5..120 seconds]');
const target = resolve(directory, 'AstraAlto.exe').toLowerCase();
// Never interpolate paths or user input into shell code. Export only selected safe fields.
const command = `$ErrorActionPreference='Stop'; $rows=@(Get-Process AstraAlto -ErrorAction SilentlyContinue | ForEach-Object { $p=$_; $path=$null; $cpu=$null; $start=$null; try {$path=$p.Path} catch {}; try {$cpu=$p.CPU} catch {}; try {$start=$p.StartTime.ToUniversalTime().ToString('o')} catch {}; [pscustomobject]@{id=$p.Id;path=$path;workingSetBytes=$p.WorkingSet64;privateBytes=$p.PrivateMemorySize64;cpuSeconds=$cpu;startedAt=$start} }); ConvertTo-Json -InputObject $rows -Compress`;
const sample = () => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, encoding: 'utf8', timeout: 10000 });
  if (result.status !== 0) return { at: new Date().toISOString(), status: 'NOT_TESTED', reason: 'PROCESS_QUERY_FAILED' };
  const all = JSON.parse(result.stdout.trim() || '[]');
  const processes = all.filter(p => !p.path || p.path.toLowerCase() === target).map(({ path, ...p }) => ({ ...p, association: path ? 'MATCHED_EXECUTABLE' : 'NAME_ONLY_PATH_INACCESSIBLE' }));
  return { at: new Date().toISOString(), status: 'PASS', processes, count: processes.length, workingSetBytes: processes.reduce((n, p) => n + p.workingSetBytes, 0), privateBytes: processes.reduce((n, p) => n + p.privateBytes, 0) };
};
const report = { recordedAt: new Date().toISOString(), executable: target, phase, method: 'Get-Process snapshots every five seconds. Matching paths plus explicitly uncertain same-name processes. Parent/type classification not established; shared pages may be counted more than once. No inference of full tree or idle workload.', logicalProcessors: Number(process.env.NUMBER_OF_PROCESSORS) || null, samples: [], completeTreeQualified: false, perTypeMemory: null, coldStartupMs: null, warmStartupMs: null, shutdownMs: null };
const started = Date.now();
do {
  report.samples.push(sample());
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  if (Date.now() - started >= duration * 1000) break;
  await new Promise(done => setTimeout(done, Math.min(5000, duration * 1000 - (Date.now() - started))));
} while (true);
const first = report.samples[0]; const last = report.samples.at(-1);
if (first.status === 'PASS' && last.status === 'PASS') {
  const elapsed = (Date.parse(last.at) - Date.parse(first.at)) / 1000;
  const stable = last.processes.filter(p => p.startedAt !== null && p.cpuSeconds !== null && first.processes.some(q => q.id === p.id && q.startedAt === p.startedAt && q.cpuSeconds !== null && p.cpuSeconds >= q.cpuSeconds));
  const cpu = stable.reduce((n, p) => n + p.cpuSeconds - first.processes.find(q => q.id === p.id).cpuSeconds, 0);
  report.summary = { elapsedSeconds: elapsed, sampledProcessCount: last.count, cpuMeasuredProcessCount: stable.length, partialCpuPercentOfMachine: elapsed > 0 && report.logicalProcessors && stable.length ? cpu / elapsed / report.logicalProcessors * 100 : null, cpuCompleteForSampledProcesses: last.count > 0 && stable.length === last.count && stable.length === first.count, maxSampledWorkingSetBytes: Math.max(...report.samples.filter(s => s.status === 'PASS').map(s => s.workingSetBytes)), maxSampledPrivateBytes: Math.max(...report.samples.filter(s => s.status === 'PASS').map(s => s.privateBytes)) };
}
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.summary ?? { status: 'NOT_TESTED' }));
if (!report.summary || !report.summary.sampledProcessCount) process.exitCode = 1;

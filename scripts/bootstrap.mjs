// Offline provisioning from already installed packages; never fetches or runs scripts.
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const names = ['typescript', '@types/node', 'undici-types'];
const sources = process.argv.slice(2);
if (sources.length !== 3) {
  throw new Error('Usage: node scripts/bootstrap.mjs <typescript-dir> <@types/node-dir> <undici-types-dir>');
}
// Validate all sources before copying anything. Source directories are read only.
for (let i = 0; i < names.length; i++) {
  const pkg = JSON.parse(readFileSync(resolve(sources[i], 'package.json'), 'utf8'));
  if (pkg.name !== names[i] || pkg.version !== manifest.devDependencies[names[i]]) {
    throw new Error(`Expected ${names[i]}@${manifest.devDependencies[names[i]]}`);
  }
}
for (let i = 0; i < names.length; i++) {
  const target = resolve(root, 'node_modules', names[i]);
  if (!existsSync(target)) {
    mkdirSync(dirname(target), { recursive: true });
    cpSync(realpathSync(sources[i]), target, { recursive: true, dereference: true });
  }
  const installed = JSON.parse(readFileSync(resolve(target, 'package.json'), 'utf8'));
  if (installed.version !== manifest.devDependencies[names[i]]) throw new Error(`Unexpected installed ${names[i]}`);
}
for (const name of ['core', 'application', 'adapters', 'infrastructure']) {
  const target = resolve(root, 'node_modules/@ptcg', name);
  mkdirSync(dirname(target), { recursive: true });
  if (!existsSync(target)) symlinkSync(resolve(root, 'packages', name), target, process.platform === 'win32' ? 'junction' : 'dir');
}
console.log('Offline toolchain and four workspace packages ready. No install scripts or network used.');

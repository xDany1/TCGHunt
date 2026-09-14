import { build } from 'esbuild';
import { createPackageWithOptions } from '@electron/asar';
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve, join, dirname, extname, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Resolve source with Node inside the workspace. Native directory discovery otherwise
// attempts to enumerate denied ancestor directories in the Windows build sandbox.
const workspace = resolve('.');
const localFiles = {
  name: 'workspace-files', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      if (args.path === 'electron' || args.path === 'playwright-core' || args.path.startsWith('node:')) return { path: args.path, external: true };
      let path;
      if (isAbsolute(args.path)) path = args.path;
      else if (args.path.startsWith('.')) {
        path = resolve(dirname(args.importer), args.path);
        if (!existsSync(path) && path.endsWith('.js')) path = existsSync(path.slice(0, -3) + '.ts') ? path.slice(0, -3) + '.ts' : path.slice(0, -3) + '.tsx';
      } else path = createRequire(args.importer || import.meta.url).resolve(args.path);
      if (!path.startsWith(workspace + '\\') && !path.startsWith(workspace + '/')) throw new Error('Dependency outside workspace');
      return { path, namespace: 'workspace' };
    });
    builder.onLoad({ filter: /.*/, namespace: 'workspace' }, args => ({ contents: readFileSync(args.path, 'utf8'), loader: ({ '.ts': 'ts', '.tsx': 'tsx', '.css': 'css', '.json': 'json' })[extname(args.path)] ?? 'js' }));
  }
};
const testing = process.argv.includes('--test');
const root = resolve(testing ? 'work/m4-test-build' : 'work/m4-build');
const source = join(root, 'app'); mkdirSync(source, { recursive: true });
for (const [name, entry] of Object.entries({ main: 'host/main.ts', preload: 'host/preload.ts', coordinator: 'coordinator/runtime.ts', 'adapter-worker': 'coordinator/adapter-worker.ts' })) {
  await build({
    plugins: [localFiles], entryPoints: [resolve(`apps/desktop/src/${entry}`)], tsconfigRaw: {}, outfile: join(source, `${name}.cjs`), bundle: true, platform: 'node', target: 'node24', format: 'cjs', external: ['electron'], minifySyntax: true,
    define: { __M4_TESTING__: String(testing), 'process.env.NODE_ENV': '"production"' }, legalComments: 'eof'
  });
}
await build({ plugins: [localFiles], entryPoints: [resolve('apps/desktop/src/renderer/index.tsx')], tsconfigRaw: {}, outfile: join(source, 'renderer.js'), bundle: true, platform: 'browser', target: 'chrome152', format: 'iife', jsx: 'automatic', minify: true, define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'eof' });
writeFileSync(join(source, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Astra Alto — DRY RUN</title><link rel="stylesheet" href="renderer.css"></head><body><div id="root"></div><script src="renderer.js"></script></body></html>');
if (testing) cpSync('scripts/desktop-e2e.cjs', join(source, 'desktop-e2e.cjs'));
// Keep Playwright's own runtime layout intact; use the target's qualified Edge installation.
cpSync(dirname(require.resolve('playwright-core/package.json')), join(source, 'node_modules/playwright-core'), { recursive: true });
writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'astra-alto', version: '0.4.0', main: testing ? 'desktop-e2e.cjs' : 'main.cjs' }));
if (!testing && readFileSync(join(source, 'adapter-worker.cjs'), 'utf8').includes('AUTHORED FIXTURE')) throw new Error('Test fixture leaked into production');
const target = join(root, 'Astra Alto'); mkdirSync(target, { recursive: true });
const electronDist = join(require.resolve('electron/package.json'), '..', 'dist');
for (const name of readdirSync(electronDist)) cpSync(join(electronDist, name), join(target, name === 'electron.exe' ? 'AstraAlto.exe' : name), { recursive: true });
if (existsSync(join(target, 'electron.exe'))) unlinkSync(join(target, 'electron.exe'));
for (const name of ['react', 'react-dom']) cpSync(join(require.resolve(name + '/package.json'), '..', 'LICENSE'), join(target, `LICENSE.${name}.txt`));
await createPackageWithOptions(source, join(target, 'resources', 'app.asar'), { unpack: '{coordinator,adapter-worker}.cjs', unpackDir: 'node_modules/playwright-core' });
writeFileSync(join(target, 'README.txt'), 'Astra Alto M4 — DRY RUN ONLY\nLaunch AstraAlto.exe. Data: %APPDATA%\\Astra Alto\\astra.sqlite. No Node installation required.\nNetwork is disabled by default. See outputs/M4_REPORT.md for opt-in validation and limitations.\nUnsigned internal validation package; no auto-update or purchase capability.\n');
console.log(JSON.stringify({ status: 'BUILT', testing, application: target }));

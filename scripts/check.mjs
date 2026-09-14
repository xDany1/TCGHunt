import ts from 'typescript';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const mode = process.argv[2] ?? 'all';
if (!['build', 'typecheck', 'lint', 'format', 'format:check', 'test', 'all'].includes(mode)) throw new Error('Unknown check');
const walk = (dir, extension) => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  if (['dist', 'renderer-dist', 'node_modules'].includes(entry.name)) return [];
  const path = resolve(dir, entry.name);
  return entry.isDirectory() ? walk(path, extension) : path.endsWith(extension) ? [path] : [];
});
const files = [...walk('packages', '.ts'), ...walk('tests', '.ts'), ...walk('apps', '.ts'), ...walk('apps', '.tsx')];
const formatting = {
  indentSize: 2, tabSize: 2, newLineCharacter: '\n', convertTabsToSpaces: true,
  insertSpaceAfterCommaDelimiter: true, insertSpaceAfterSemicolonInForStatements: true,
  insertSpaceBeforeAndAfterBinaryOperators: true, insertSpaceAfterKeywordsInControlFlowStatements: true,
  insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: true, semicolons: ts.SemicolonPreference.Insert
};

function format() {
  let failed = false;
  for (const file of [...files, ...walk('scripts', '.mjs'), ...walk('scripts', '.cjs'), ...walk('tests', '.mjs')]) {
    const original = readFileSync(file, 'utf8');
    let formatted = original;
    let version = 0;
    const host = {
      getCompilationSettings: () => ({ allowJs: true }), getScriptFileNames: () => [file],
      getScriptVersion: () => String(version), getScriptSnapshot: name => name === file ? ts.ScriptSnapshot.fromString(formatted) : undefined,
      getCurrentDirectory: () => root, getDefaultLibFileName: opts => ts.getDefaultLibFilePath(opts),
      fileExists: ts.sys.fileExists, readFile: ts.sys.readFile
    };
    const service = ts.createLanguageService(host);
    // Some multiline constructs need a second indentation pass after inserted spaces.
    for (; version < 5; version++) {
      const previous = formatted;
      for (const edit of service.getFormattingEditsForDocument(file, formatting).sort((a, b) => b.span.start - a.span.start)) {
        formatted = formatted.slice(0, edit.span.start) + edit.newText + formatted.slice(edit.span.start + edit.span.length);
      }
      formatted = formatted.replace(/\r\n/g, '\n').replace(/[\t ]+$/gm, '').trimEnd() + '\n';
      if (formatted === previous) break;
    }
    service.dispose();
    if (version === 5) throw new Error(`Formatter did not stabilize: ${relative(root, file)}`);
    if (original !== formatted) {
      if (mode === 'format') writeFileSync(file, formatted);
      else { console.error(`Formatting: ${relative(root, file)}`); failed = true; }
    }
  }
  return failed ? 1 : 0;
}

function lint() {
  let errors = 0;
  for (const file of files.filter(f => f.includes(`${resolve('packages')}`))) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const pkg = relative(resolve('packages'), file).split(/[\\/]/)[0];
    const allowed = { core: [], contracts: [], application: ['@ptcg/core'], adapters: ['@ptcg/core', '@ptcg/application', 'node:url', 'node:buffer', 'node:crypto'], infrastructure: ['@ptcg/core', '@ptcg/application', 'node:sqlite'] }[pkg];
    const fail = (node, message) => {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      console.error(`${relative(root, file)}:${line + 1}: ${message}`); errors++;
    };
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        const specifier = node.moduleSpecifier.text;
        if (specifier.startsWith('.')) {
          if (!resolve(dirname(file), specifier).startsWith(resolve('packages', pkg, 'src') + sep)) fail(node, 'Import leaves package source boundary');
        } else if (!allowed.includes(specifier)) fail(node, 'Only declared inward workspace imports are allowed');
      }
      if (node.kind === ts.SyntaxKind.AnyKeyword || ts.isNonNullExpression(node)) fail(node, 'Avoid any / non-null assertions');
      if (ts.isIdentifier(node) && ['fetch', 'XMLHttpRequest', 'WebSocket', 'Date', 'process', 'require', 'eval', 'Function', 'setTimeout', 'setInterval'].includes(node.text)) fail(node, 'Side effects / ambient time are excluded from M1');
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) fail(node, 'No dynamic imports');
      if (ts.isPropertyAccessExpression(node) && node.expression.getText(source) === 'Math' && node.name.text === 'random') fail(node, 'Inject deterministic inputs');
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  for (const file of files.filter(f => f.startsWith(resolve('apps') + sep))) {
    const text = readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const renderer = file.startsWith(resolve('apps/desktop/src/renderer') + sep);
    const fail = message => { console.error(`${relative(root, file)}: ${message}`); errors++; };
    const visit = node => {
      if (node.kind === ts.SyntaxKind.AnyKeyword || ts.isNonNullExpression(node)) fail('Avoid any / non-null assertions');
      if (ts.isIdentifier(node) && ['eval', 'Function', 'dangerouslySetInnerHTML'].includes(node.text)) fail('Executable display content is prohibited');
      if (renderer && ts.isIdentifier(node) && ['process', 'require', 'fetch', 'XMLHttpRequest', 'WebSocket', 'ipcRenderer'].includes(node.text)) fail('Renderer has no host/network authority');
      if (renderer && (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        const name = node.moduleSpecifier.text;
        if (name.startsWith('.')) { if (!resolve(dirname(file), name).startsWith(resolve('apps/desktop/src/renderer') + sep)) fail('Renderer import leaves presentation boundary'); }
        else if (!['react', 'react-dom/client', '@ptcg/contracts'].includes(name)) fail('Renderer imports only React and presentation contracts');
      }
      if (file.endsWith('adapter-worker.ts') && ts.isImportDeclaration(node) && /infrastructure|sqlite/.test(node.moduleSpecifier.text)) fail('Adapter worker has no database ownership');
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return errors ? 1 : 0;
}

function build() {
  const report = d => console.error(ts.formatDiagnosticsWithColorAndContext([d], {
    getCanonicalFileName: f => f, getCurrentDirectory: () => root, getNewLine: () => '\n'
  }));
  const builder = ts.createSolutionBuilder(ts.createSolutionBuilderHost(ts.sys, undefined, report), ['tsconfig.json'], { force: true });
  return builder.build();
}

let status = 0;
if (['format', 'format:check', 'all'].includes(mode)) status ||= format();
if (['lint', 'all'].includes(mode)) status ||= lint();
if (['build', 'typecheck', 'test', 'all'].includes(mode) && !status) status = build();
if (['test', 'all'].includes(mode) && !status) {
  // Derive tests from current sources so deleted tests cannot survive as stale output.
  const tests = [...files.filter(file => file.endsWith('.test.ts')).map(file => resolve('tests/dist', relative(resolve('tests'), file)).replace(/\.ts$/, '.js')), ...walk('tests', '.test.mjs')];
  if (!tests.length) throw new Error('No tests discovered');
  status = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...tests], { stdio: 'inherit' }).status ?? 1;
}
process.exitCode = status;

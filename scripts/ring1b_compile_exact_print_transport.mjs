#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sourcePath = process.argv[2];
const outputPath = process.argv[3];
const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
if (!sourcePath || !outputPath) throw new Error('R1B_EXACT_PRINT_TRANSPORT_ARGS_REQUIRED');

const tsPath = path.join(workspace, 'source/apps/smt-clean/node_modules/typescript/lib/typescript.js');
const ts = await import(pathToFileURL(tsPath).href);
const source = fs.readFileSync(sourcePath, 'utf8');
const transformed = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2019,
    module: ts.ModuleKind.CommonJS,
    strict: true,
    esModuleInterop: false,
  },
  fileName: path.basename(sourcePath),
  reportDiagnostics: true,
});
const errors = (transformed.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
if (errors.length) {
  throw new Error('R1B_EXACT_PRINT_TRANSPORT_TRANSPILE_FAILED:' + errors.map(d => d.code).join(','));
}
const wrapped = [
  '(()=>{',
  'const module={exports:{}};',
  'const exports=module.exports;',
  transformed.outputText,
  'globalThis.__R1B_EXACT_PRINT_TRANSPORT__=module.exports;',
  '})();',
  ''
].join('\n');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, wrapped, 'utf8');
console.log('R1B_EXACT_PRINT_TRANSPORT_COMPILED=' + outputPath);

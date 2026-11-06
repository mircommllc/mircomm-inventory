// Syntax check for the Apps Script backend: Apps Script loads every .gs into ONE global scope,
// so we join them the same way and let Node parse the result. Catches typos and duplicate
// top-level const/let/function-name clashes before anything gets deployed.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const dir = new URL('../backend/', import.meta.url).pathname;
const files = readdirSync(dir).filter(f => f.endsWith('.gs')).sort();
let ok = true;
for (const f of files) {
  const tmp = join(tmpdir(), 'gs-' + f.replace(/\W/g, '_') + '.js');
  writeFileSync(tmp, readFileSync(join(dir, f), 'utf8'));
  try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
  catch (e) { ok = false; console.error('✗ ' + f + '\n' + String(e.stderr)); }
}
const all = files.map(f => readFileSync(join(dir, f), 'utf8')).join('\n;\n');
const tmpAll = join(tmpdir(), 'gs-all.js');
writeFileSync(tmpAll, all);
try { execFileSync(process.execPath, ['--check', tmpAll], { stdio: 'pipe' }); }
catch (e) { ok = false; console.error('✗ joined project (duplicate top-level names?)\n' + String(e.stderr)); }
// Functions defined twice silently override each other in Apps Script — flag them.
const seen = {};
for (const f of files) for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/^function\s+([\w$]+)\s*\(/gm)) (seen[m[1]] ||= []).push(f);
for (const [n, fs] of Object.entries(seen)) if (fs.length > 1) { ok = false; console.error(`✗ function ${n} defined in: ${fs.join(', ')}`); }
console.log(ok ? `✓ ${files.length} backend files OK` : 'Backend check FAILED');
process.exit(ok ? 0 : 1);

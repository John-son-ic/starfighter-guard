import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
function collect(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collect(path) : entry.name.endsWith('.test.mjs') ? [path] : [];
  });
}
const tests = collect(resolve(root, 'tests')).sort();
if (!tests.length) throw new Error('No test files found');
const result = spawnSync(process.execPath, ['--test', ...tests], {
  cwd: root,
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);

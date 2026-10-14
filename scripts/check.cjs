const { readdirSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
for (const directory of ['src', 'scripts', 'test', 'test/fixtures']) {
  for (const file of readdirSync(path.join(__dirname, '..', directory))) {
    if (!/\.(cjs|js)$/.test(file)) continue;
    const result = spawnSync(process.execPath, ['--check', path.join(__dirname, '..', directory, file)], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
console.log('JavaScript syntax checks passed.');

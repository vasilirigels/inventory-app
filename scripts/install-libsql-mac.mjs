// Download @libsql/darwin-x64 and @libsql/darwin-arm64 tarballs directly into
// node_modules. Bypasses `npm install --force` (which drops other optional
// deps due to npm bug #4828) and platform checks that reject the "wrong" arch.
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { get } from 'node:https';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const libsqlVersion = JSON.parse(readFileSync(join(root, 'node_modules/libsql/package.json'), 'utf8')).version;
const archs = ['darwin-x64', 'darwin-arm64'];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const req = get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      const file = createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });
    req.on('error', reject);
  });
}

for (const arch of archs) {
  const target = join(root, 'node_modules/@libsql', arch);
  if (existsSync(join(target, 'index.node'))) {
    console.log(`[libsql-mac] ${arch} already present, skipping`);
    continue;
  }
  await rm(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  const url = `https://registry.npmjs.org/@libsql/${arch}/-/${arch}-${libsqlVersion}.tgz`;
  const tgz = join(target, 'package.tgz');
  console.log(`[libsql-mac] downloading ${url}`);
  await download(url, tgz);
  const r = spawnSync('tar', ['-xzf', tgz, '--strip-components=1', '-C', target], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`tar failed for ${arch}`);
  await rm(tgz);
  console.log(`[libsql-mac] ${arch} installed`);
}

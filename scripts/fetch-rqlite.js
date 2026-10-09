/**
 * Downloads pinned rqlite binaries into resources/rqlite/<platform>-<arch>/.
 * Usage: node scripts/fetch-rqlite.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const VERSION = process.env.RQLITE_VERSION || '10.5.2';
const ROOT = path.join(__dirname, '..', 'resources', 'rqlite');

const TARGETS = [
  { platform: 'windows', arch: 'amd64', asset: `rqlite-v${VERSION}-win64.zip` },
  { platform: 'linux', arch: 'amd64', asset: `rqlite-v${VERSION}-linux-amd64.tar.gz` },
  { platform: 'linux', arch: 'arm64', asset: `rqlite-v${VERSION}-linux-arm64.tar.gz` }
];

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        get(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`${url} returned ${res.statusCode}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function main() {
  const only = process.env.RQLITE_TARGET;
  for (const target of TARGETS) {
    const id = `${target.platform}-${target.arch}`;
    if (only && only !== id) continue;
    const name = target.asset;
    const url = `https://github.com/rqlite/rqlite/releases/download/v${VERSION}/${name}`;
    const destDir = path.join(ROOT, id);
    fs.mkdirSync(destDir, { recursive: true });
    console.log(`Fetching ${url}`);
    const archive = await get(url);
    const archivePath = path.join(destDir, name);
    fs.writeFileSync(archivePath, archive);
    if (name.endsWith('.zip')) {
      execFileSync('tar', ['-xf', archivePath, '-C', destDir], { stdio: 'inherit' });
    } else {
      execFileSync('tar', ['-xzf', archivePath, '-C', destDir], { stdio: 'inherit' });
    }
    const nested = fs.readdirSync(destDir).map(entry => path.join(destDir, entry)).find(entry => fs.statSync(entry).isDirectory());
    if (nested && fs.existsSync(nested)) {
      for (const entry of fs.readdirSync(nested)) {
        fs.renameSync(path.join(nested, entry), path.join(destDir, entry));
      }
      fs.rmSync(nested, { recursive: true, force: true });
    }
    fs.rmSync(archivePath, { force: true });
    console.log(`Installed ${id}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

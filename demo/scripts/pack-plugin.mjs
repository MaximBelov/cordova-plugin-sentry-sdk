/* eslint-disable no-console */
// Installs the plugin THIS checkout holds into the demo, as npm would ship it. `cordova plugin add ..` copies the parent directory,
// which contains the demo itself, and fails (or installs nothing) in the recursion; `npm pack` takes only the files listed in
// package.json, so the copy is the plugin and nothing else.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// cordova installs a plugin from a folder with `npm install <folder>`, which also installs the devDependencies of that package (a
// local cordova among them) into the demo and breaks the next cordova call. A plugin needs its plugin.xml and sources only.
function dropDevelopmentFields(dir) {
  const manifestPath = join(dir, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  delete manifest.devDependencies;
  delete manifest.scripts;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

const demo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(demo, '..');
const out = join(demo, '.plugin');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const tarball = execFileSync('npm', ['pack', '--silent', '--pack-destination', out], { cwd: root, encoding: 'utf8' }).trim().split('\n').pop();
execFileSync('tar', ['-xzf', join(out, tarball), '-C', out, '--strip-components=1']);
rmSync(join(out, tarball));
dropDevelopmentFields(out);
const { id } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).cordova;
try {
  execFileSync('cordova', ['plugin', 'rm', id, '--nosave'], { cwd: demo, stdio: 'ignore' });
} catch {
  // not installed yet
}
execFileSync('cordova', ['plugin', 'add', out, '--nosave'], { cwd: demo, stdio: 'inherit' });
console.log(`installed ${id} from ${out}`);

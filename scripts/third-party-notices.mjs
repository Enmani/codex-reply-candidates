import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export async function writeThirdPartyNotices(inputs, output) {
  const packages = new Map();
  for (const input of Object.keys(inputs)) {
    if (!input.includes('node_modules')) continue;
    let directory = dirname(resolve(input));
    while (directory.includes('node_modules')) {
      try {
        const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
        if (pkg.name) {
          packages.set(`${pkg.name} ${pkg.version}`, directory);
          break;
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      directory = dirname(directory);
    }
  }
  const modules = spawnSync('go', ['list', '-m', '-f', '{{.Path}} {{.Version}}|{{.Dir}}', 'all'], {
    cwd: 'plugins/reply-candidates/server', encoding: 'utf8', windowsHide: true,
  });
  if (modules.status !== 0) throw Error(modules.stderr || 'Go module notice lookup failed');
  for (const line of modules.stdout.trim().split(/\r?\n/)) {
    const [name, directory] = line.split('|');
    if (directory && !name.startsWith('github.com/Enmani/')) packages.set(name, directory);
  }
  const goRoot = spawnSync('go', ['env', 'GOROOT'], { cwd: 'plugins/reply-candidates/server', encoding: 'utf8', windowsHide: true });
  if (goRoot.status !== 0) throw Error(goRoot.stderr || 'Go runtime notice lookup failed');
  packages.set('Go runtime', goRoot.stdout.trim());
  const notices = ['Third-party components used by Codex Reply Candidates.\n'];
  for (const [name, directory] of [...packages].sort()) {
    const files = (await readdir(directory)).filter(file => /^(licen[sc]e|copying|notice)(\..*)?$/i.test(file));
    const texts = [];
    for (const file of files) {
      if ((await stat(join(directory, file))).isFile()) texts.push(await readFile(join(directory, file), 'utf8'));
    }
    if (!texts.length) throw Error(`License text missing: ${name}`);
    notices.push(`\n----- ${name} -----\n\n${texts.join('\n')}`);
  }
  await writeFile(output, notices.join('\n'));
}

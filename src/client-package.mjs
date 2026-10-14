import { join, normalize, resolve } from 'node:path';
import { extractFile, listPackage } from '@electron/asar';
import { runInNewContext } from 'node:vm';

export const defaultApp = 'C:/Program Files/WindowsApps/OpenAI.Codex_26.1007.2314.0_x64__2p2nqsd0c76g0/app';
export const sourceApp = resolve(process.env.CODEX_CANDIDATES_SOURCE_APP || defaultApp);

export function readBundledText(pattern, appDirectory = sourceApp) {
  const archive = join(appDirectory, 'resources', 'app.asar');
  const members = listPackage(archive).map(name => name.replaceAll('\\', '/').replace(/^\//, ''));
  const matches = members.filter(name => pattern.test(name));
  if (matches.length !== 1) throw new Error(`Expected one bundle for ${pattern}, found ${matches.length}`);
  return { member: matches[0], text: extractFile(archive, normalize(matches[0])).toString('utf8') };
}

// Load only the inspected CommonJS schema chunk and its shipped runtime helper.
// Nothing is extracted into the repository or copied from the user's history.
export function loadShippedSchemaLibrary(appDirectory = sourceApp) {
  const runtime = readBundledText(/^\.vite\/build\/rolldown-runtime-[\w-]+\.js$/, appDirectory);
  const schema = readBundledText(/^\.vite\/build\/zod-[\w-]+\.js$/, appDirectory);
  const cache = new Map();
  function load(bundle) {
    if (cache.has(bundle.member)) return cache.get(bundle.member);
    const exports = {};
    cache.set(bundle.member, exports);
    runInNewContext(bundle.text, {
      exports,
      module: { exports },
      require(name) {
        if (name !== './' + runtime.member.split('/').at(-1)) throw new Error(`Unexpected schema dependency: ${name}`);
        return load(runtime);
      },
    });
    return exports;
  }
  return load(schema);
}

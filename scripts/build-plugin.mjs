import { build } from 'esbuild';
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeThirdPartyNotices } from './third-party-notices.mjs';

const root=resolve('plugins/reply-candidates');
const embedded=join(root,'server/cmd/reply-candidates/assets');
await mkdir(embedded,{recursive:true});
const library=import.meta.resolve('@electron/asar');
const pickle=fileURLToPath(new URL('./pickle.js',library));
const integrity=fileURLToPath(new URL('./integrity.js',library));
const bundle=await build({entryPoints:[resolve('scripts/installer-patch.mjs')],bundle:true,format:'cjs',platform:'node',target:'node22',write:false,metafile:true,
  banner:{js:"const __installerModuleUrl = require('node:url').pathToFileURL(__filename).href;"},define:{'import.meta.url':'__installerModuleUrl'},
  plugins:[{name:'bundle-asar-serializers',setup(b){
    b.onLoad({filter:/[\\/]asar-overlay\.mjs$/},async ({path})=>({loader:'js',contents:(await readFile(path,'utf8')).replace(/const libraryUrl = import\.meta\.resolve\('@electron\/asar'\);\s*const \{ Pickle \} = await import\(new URL\('\.\/pickle\.js', libraryUrl\)\);\s*const \{ getFileIntegrityFromBuffer \} = await import\(new URL\('\.\/integrity\.js', libraryUrl\)\);/,
      `import {Pickle} from ${JSON.stringify(pickle)};\nimport {getFileIntegrityFromBuffer} from ${JSON.stringify(integrity)};`)}));
  }}]});
await writeFile(join(embedded,'patcher.cjs'),bundle.outputFiles[0].text);
for(const [source,name] of [['plugin.json','plugin.json'],['.codex-plugin/plugin.json','compatibility.json'],['mcp.json','mcp.json']])await cp(join(root,source),join(embedded,name));
await cp('LICENSE',join(embedded,'LICENSE.txt'));
await writeThirdPartyNotices(bundle.metafile.inputs, 'THIRD_PARTY_NOTICES.txt');
await cp('THIRD_PARTY_NOTICES.txt',join(embedded,'THIRD_PARTY_NOTICES.txt'));
if(process.argv.includes('--assets-only'))process.exit(0);
await mkdir('dist/plugin',{recursive:true});
const executable=resolve('dist/plugin/CodexReplyCandidates-Setup.exe');
const compiled=spawnSync('go',['build','-trimpath','-ldflags','-H=windowsgui','-o',executable,'./cmd/reply-candidates'],{cwd:join(root,'server'),encoding:'utf8',windowsHide:true});
if(compiled.status!==0)throw new Error(compiled.stderr||'Plugin compilation failed');
console.log(JSON.stringify({executable}));

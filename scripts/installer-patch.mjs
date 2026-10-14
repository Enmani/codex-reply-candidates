import { extractFile, listPackage, getRawHeader } from '@electron/asar';
import { normalize, join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { transformBackend } from '../src/backend-patch.mjs';
import { transformRenderer } from '../src/renderer-patch.mjs';
import { writeAsarOverlay } from '../src/asar-overlay.mjs';

async function main() {
  const [sourceApp, outputArchive, metadataPath, debugPort] = process.argv.slice(2);
  if (!sourceApp || !outputArchive || !metadataPath) throw new Error('Installation paths are required');
  const archive=join(sourceApp,'resources/app.asar');
  const members=listPackage(archive).map(name=>name.replaceAll('\\','/').replace(/^\//,''));
  function find(pattern){const matches=members.filter(name=>pattern.test(name));if(matches.length!==1)throw new Error('This Codex build is not supported');return matches[0];}
  const backend=find(/^\.vite\/build\/main-[\w-]+\.js$/);
  const renderer=find(/^webview\/assets\/app-primary-[\w-]+\.js$/);
  const read=member=>extractFile(archive,normalize(member)).toString('utf8');
  const replacements=new Map([[backend,transformBackend(read(backend))],[renderer,transformRenderer(read(renderer))]]);
  if(debugPort){
    if(debugPort!=='9338')throw new Error('Unsupported development port');
    const member='.vite/build/early-bootstrap.js',marker='let r=require("electron");',early=read(member);
    if(early.split(marker).length!==2)throw new Error('Unsupported development bootstrap');
    replacements.set(member,early.replace(marker,marker+`r.app.commandLine.appendSwitch('remote-debugging-port','${debugPort}');`));
  }
  await writeAsarOverlay(archive,outputArchive,replacements);
  // Generate packaging metadata required by the native runtime, without comparing digests.
  const value=createHash('sha256').update(getRawHeader(outputArchive).headerString).digest('hex');
  await writeFile(metadataPath,JSON.stringify([{file:'resources\\app.asar',alg:'SHA256',value}]));
  console.log(JSON.stringify({version:JSON.parse(read('package.json')).version,backend,renderer}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});

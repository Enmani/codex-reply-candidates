import { spawnSync } from 'node:child_process';

for (const [command,args,cwd] of [
  ['node',['scripts/build-plugin.mjs','--assets-only'],process.cwd()],
  ['node',['--test','tests/*.test.mjs'],process.cwd()],
  ['go',['test','./...'], 'plugins/reply-candidates/server'],
  ['go',['vet','./...'], 'plugins/reply-candidates/server'],
]) {
  const result=spawnSync(command,args,{cwd,stdio:'inherit',windowsHide:true});
  if(result.status!==0) process.exit(result.status??1);
}

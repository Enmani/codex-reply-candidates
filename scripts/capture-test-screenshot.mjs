import { mkdir } from 'node:fs/promises';
import { inspectTestRuntime } from './cdp-read.mjs';

const name = process.argv[2];
if (!name || !/^[a-z0-9-]+$/.test(name)) throw new Error('Specify a simple screenshot name');
await mkdir('docs/images', { recursive: true });
const path = `docs/images/${name}.png`;
const result = await inspectTestRuntime(`(()=>{
  const element=document.querySelector('[data-codex-multi-predictions]');
  if(!element)throw Error('Test candidate panel is not visible');
  const rectangle=element.getBoundingClientRect();
  const x=Math.max(0,rectangle.x-8),y=Math.max(0,rectangle.y-8);
  return{panelText:element.innerText,screenshotClip:{x,y,width:Math.min(innerWidth-x,rectangle.width+16),height:innerHeight-y,scale:1}};
})()`,path);
console.log(JSON.stringify({path,panelText:result.panelText}));

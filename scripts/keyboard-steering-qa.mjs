import assert from 'node:assert/strict';
import {build} from 'vite';
import {withBrowser} from './browser-session.mjs';
await build({logLevel:'error',build:{outDir:'artifacts/local/c20-qa-build',emptyOutDir:false},define:{'import.meta.env.DEV':'true'}});
await withBrowser('c20-steering',async({call,evaluate,pageErrors})=>{
 await call('Page.navigate',{url:'http://127.0.0.1:5188/?qa=1'});
 for(let i=0;i<100;i++){if(await evaluate("document.querySelector('canvas')?.dataset.ready==='true'"))break;await new Promise(r=>setTimeout(r,100));}
 await evaluate("document.querySelector('#launch-button').click()");
 const key=(type,code)=>call('Input.dispatchKeyEvent',{type,code,key:code.slice(3).toLowerCase()});
 await key('keyDown','KeyA');assert.equal(await evaluate('__flightQA.input().yaw'),-1);
 await key('keyDown','KeyD');assert.equal(await evaluate('__flightQA.input().yaw'),0);
 await key('keyUp','KeyA');assert.equal(await evaluate('__flightQA.input().yaw'),1);
 await key('keyUp','KeyD');assert.equal(await evaluate('__flightQA.input().yaw'),0);
 await key('keyDown','KeyA');await evaluate('__flightQA.pause()');assert.equal(await evaluate('__flightQA.input().yaw'),0);
 assert.deepEqual(pageErrors,[]);return{checks:['A left','D right','both neutral','release restores mouse','pause clears held keys']};
},{serverArgs:['--input-type=module','-e',"import{createReleaseServer}from'./scripts/serve-release.mjs';createReleaseServer('artifacts/local/c20-qa-build').listen(5188,'127.0.0.1',()=>console.log('Local: ready'))"]});

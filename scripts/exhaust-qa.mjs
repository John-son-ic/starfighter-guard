import assert from 'node:assert/strict';
import {build} from 'vite';
import {withBrowser} from './browser-session.mjs';
await build({logLevel:'error',build:{outDir:'artifacts/local/c15-qa-build',emptyOutDir:false},define:{'import.meta.env.DEV':'true'}});
await withBrowser('c15-exhaust',async({call,evaluate,capture,pageErrors})=>{
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:'http://127.0.0.1:5188/?qa=1'});
 for(let i=0;i<100;i++){if(await evaluate('!!window.__flightQA'))break;await new Promise(r=>setTimeout(r,100));}
 await evaluate(`document.querySelector('#launch-button').click()`);
 await capture('normal');
 await call('Input.dispatchKeyEvent',{type:'keyDown',code:'ShiftLeft',key:'Shift'});
 await new Promise(r=>setTimeout(r,800));
 const boosted=await evaluate('__flightQA.diagnostics()');assert.ok(boosted.exhaust>.8);
 await evaluate("__flightQA.pause();document.querySelector('.flight-overlay').style.display='none'");
 await capture('boost');
 await call('Input.dispatchKeyEvent',{type:'keyUp',code:'ShiftLeft',key:'Shift'});
 await evaluate("document.querySelector('.flight-overlay').style.removeProperty('display');document.querySelector('#launch-button').click()");
 await new Promise(r=>setTimeout(r,900));
 assert.ok((await evaluate('__flightQA.diagnostics()')).exhaust<.01);
 await evaluate('__flightQA.restart();__flightQA.pause()');assert.equal((await evaluate('__flightQA.diagnostics()')).exhaust,0);
 assert.deepEqual(pageErrors,[]);return{boosted,checks:['actual Shift boost','smooth release','restart clears exhaust'],note:'Software-rendered visual check; not hardware FPS evidence.'};
},{serverArgs:['--input-type=module','-e',"import{createReleaseServer}from'./scripts/serve-release.mjs';createReleaseServer('artifacts/local/c15-qa-build').listen(5188,'127.0.0.1',()=>console.log('Local: ready'))"]});

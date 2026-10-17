import assert from 'node:assert/strict';
import {withBrowser} from './browser-session.mjs';
await withBrowser('c19-munificent',async({call,evaluate,capture,pageErrors})=>{
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:'http://127.0.0.1:5188/?mode=models&model=munificent'});
 for(let i=0;i<100;i++){if(await evaluate("document.querySelector('canvas')?.dataset.ready==='true'"))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await evaluate('document.documentElement.dataset.model'),'munificent');
 await capture('perspective');
 for(const view of ['rear','top']){await evaluate(`document.querySelector('[data-view="${view}"]').click()`);await capture(view);}
 assert.deepEqual(pageErrors,[]);return{checks:['production model loads','perspective rear top screenshots'],triangles:13572,batches:8};
},{serverArgs:['scripts/serve-release.mjs','--port','5188'],readyPattern:/游戏已就绪/});

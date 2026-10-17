import assert from 'node:assert/strict';
import { withBrowser } from './browser-session.mjs';
await withBrowser('c10-vulture', async ({call,evaluate,capture,pageErrors})=>{
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:'http://127.0.0.1:5188/?mode=models&model=vulture'});
 await evaluate(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(document.querySelector('canvas[data-ready="true"]')){clearInterval(t);resolve(true)}else if(++n>200){clearInterval(t);reject(Error('timeout'))}},50)})`);
 for(const view of ['perspective','top','front','rear']){
  await evaluate(`document.querySelector('[data-view="${view}"]').click()`);
  await capture(view);
 }
 assert.deepEqual(pageErrors,[]);
 return {stats:await evaluate(`document.querySelector('#geometry-stats').textContent`)};
},{serverArgs:['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5188','--strictPort']});

import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createDuelServer} from '../src/server/duel-server.ts';

export function parseDuelArgs(argv){
  const result={host:'127.0.0.1',port:8787},origins=[];
  for(let i=0;i<argv.length;i++){
    const key=argv[i];
    if(key==='--open'){result.open=true;continue;}
    if(!['--host','--port','--origin'].includes(key)||!argv[i+1]||argv[i+1].startsWith('--'))throw new Error(`参数格式错误：${key}`);
    const value=argv[++i];
    if(key==='--host')result.host=value;
    if(key==='--port'){
      if(!/^\d+$/.test(value)||Number(value)<1||Number(value)>65535)throw new Error('端口必须在1到65535之间');
      result.port=Number(value);
    }
    if(key==='--origin')origins.push(value);
  }
  if(origins.length)result.allowedOrigins=origins;
  if(result.host==='0.0.0.0'&&!origins.length)throw new Error('监听所有网卡时请用--origin明确允许的网页来源');
  return result;
}
export async function runDuelCli(argv){
  let app;
  try{
    const {open,...options}=parseDuelArgs(argv);
    app=createDuelServer(options);
    const address=await app.listen();
    console.log(`双人对战服务：${address.origin}`);
    console.log(`连接地址：${address.wsUrl}`);
    const playUrl=address.origin+'/?mode=duel';
    console.log(`双人界面：${playUrl}`);
    console.log('两名玩家访问同一服务地址，再使用房间码加入。关闭此窗口会结束服务。');
    if(open){const child=spawn(process.platform==='win32'?'explorer.exe':process.platform==='darwin'?'open':'xdg-open',[playUrl],{stdio:'ignore',detached:true,windowsHide:true});child.on('error',()=>console.log('请手动打开上方双人界面地址。'));child.unref();}
    const stop=async()=>{await app.close();};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
    return app;
  }catch(error){
    if(app)await app.close();
    console.error(`无法启动双人服务：${error instanceof Error?error.message:String(error)}`);
    process.exitCode=1;
    return null;
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await runDuelCli(process.argv.slice(2));

import {spawn} from 'node:child_process';
import {openSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)),port=process.env.PORT||'4317',url=`http://127.0.0.1:${port}`;
async function status(){try{const res=await fetch(url+'/api/state',{signal:AbortSignal.timeout(2000)});return await res.json();}catch{return null;}}
let state=await status();
if(process.argv.includes('--stop')){if(state?.app==='hookcut'){await fetch(url+'/api/shutdown',{method:'POST',headers:{'X-Hookcut':'1'}});console.log('Hookcut stopped. Your library and exports are saved.');}else console.log('Hookcut is not running on this port.');process.exit(0);}
if(state&&state.app!=='hookcut'){console.error('Another application is using port '+port+'. Set PORT to a different number and try again.');process.exit(1);}
if(!state){const data=path.resolve(process.env.HOOKCUT_DATA||path.join(root,'.data'));mkdirSync(data,{recursive:true});const log=openSync(path.join(data,'server.log'),'a');const child=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,env:process.env,detached:true,windowsHide:true,stdio:['ignore',log,log]});child.unref();for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,200));state=await status();if(state?.app==='hookcut')break;}}
if(state?.app!=='hookcut'){console.error('Hookcut could not start. See .data/server.log for details.');process.exit(1);}
console.log('Hookcut is ready: '+url);
if(!process.argv.includes('--no-browser')){const command=process.platform==='win32'?'cmd.exe':process.platform==='darwin'?'open':'xdg-open';const args=process.platform==='win32'?['/c','start','',url]:[url];spawn(command,args,{windowsHide:true,detached:true,stdio:'ignore'}).unref();}

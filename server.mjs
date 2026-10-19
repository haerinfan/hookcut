import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { hookInput, clipInput, videoFilter, wrapHook, parseRange, filename, cleanText } from './lib/core.mjs';
import { Transcription } from './lib/transcription.mjs';
import { captionAss } from './lib/caption-render.mjs';
import { seedHooks } from './lib/seeds.mjs';
import { parseSrt, trimCaptions, formatSrt } from './public/captions.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(process.env.HOOKCUT_DATA || path.join(ROOT, '.data'));
const PORT = Number(process.env.PORT || 4317);
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const MAX_UPLOAD = 2 * 1024 ** 3;
for (const dir of [DATA, path.join(DATA,'videos'), path.join(DATA,'exports')]) await fs.mkdir(dir,{recursive:true});
const dbPath = path.join(DATA,'library.json');
let db;
try { db = JSON.parse(await fs.readFile(dbPath,'utf8')); if (!Array.isArray(db.hooks)||!Array.isArray(db.videos)||!Array.isArray(db.jobs)) throw new Error('Invalid library data.'); }
catch (e) { if(e.code !== 'ENOENT') { console.error('Library could not be opened. Your existing data has not been replaced.', e.message); process.exit(1); } db={hooks:seedHooks(),videos:[],jobs:[]}; }
let saveChain=Promise.resolve();
function save() { const content=JSON.stringify(db,null,2); saveChain=saveChain.catch(()=>{}).then(async()=>{await fs.writeFile(dbPath+'.tmp',content);await fs.rename(dbPath+'.tmp',dbPath);}); return saveChain; }
for(const j of db.jobs) if(['running','queued'].includes(j.status)) {j.status='failed';j.error='The app stopped before this export finished. Use Retry to export again.';}
await save();
const processes = new Map();
let running=false, stopping=false;
function run(binary,args,options={}) { return new Promise((resolve,reject)=>{
  const child=spawn(binary,args,{windowsHide:true,...options});let out='',err='';
  child.stdout.on('data',d=>{out+=d;if(out.length>2000000)out=out.slice(-2000000);});
  child.stderr.on('data',d=>{err=(err+d).slice(-12000);});
  child.on('error',reject);child.on('close',code=>code===0?resolve(out):reject(new Error(err||`${binary} exited with ${code}`)));
}); }
let engineReady=false;
try {await run(FFMPEG,['-version']);await run(FFPROBE,['-version']);engineReady=true;}catch{}
const filters = engineReady ? await run(FFMPEG,['-hide_banner','-filters']) : '';
const captionBurnReady = /\bsubtitles\b/.test(filters);
const transcription = new Transcription({data:DATA,ffmpeg:FFMPEG,supported:/\bwhisper\b/.test(filters),db,save});
await transcription.init(); await save();
let overlayFont;
for(const candidate of [process.env.HOOKCUT_FONT,path.join(process.env.WINDIR||'C:\\Windows','Fonts','arial.ttf'),'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','/System/Library/Fonts/Supplemental/Arial.ttf'].filter(Boolean)){try{await fs.access(candidate);overlayFont=candidate;break;}catch{}}
function json(res,status,data) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req,limit=2*1024**2){let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>limit)throw Object.assign(new Error('Request is too large.'),{status:413});chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw new Error('This is not valid JSON.');}}
function find(list,id,label){const item=list.find(x=>x.id===id);if(!item)throw Object.assign(new Error(`${label} was not found.`),{status:404});return item;}
function publicVideo(v){const {file,...rest}=v;return {...rest,url:`/media/${v.id}`};}
function publicJob(j){const {file,captions, ...rest}=j;return {...rest,url:j.status==='done'?`/exports/${j.id}`:null};}
async function serveFile(req,res,file,type,download){
  let stat;try{stat=await fs.stat(file);}catch{throw Object.assign(new Error('File is missing from disk.'),{status:404});}
  const headers={'Content-Type':type,'Accept-Ranges':'bytes','Cache-Control':'no-store'};
  if(download)headers['Content-Disposition']=`attachment; filename="${download}"`;
  let start=0,end=stat.size-1,status=200;
  if(req.headers.range){const range=parseRange(req.headers.range,stat.size);if(!range){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});res.end();return;}({start,end}=range);status=206;headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;}
  headers['Content-Length']=end-start+1;res.writeHead(status,headers);
  if(req.method==='HEAD'){res.end();return;}
  const stream=createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
}
async function probe(file){
  const data=JSON.parse(await run(FFPROBE,['-v','error','-protocol_whitelist','file,pipe','-show_format','-show_streams','-of','json',file]));
  const stream=data.streams?.find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic);
  const duration=Number(stream?.duration||data.format?.duration);
  if(!stream||!Number.isFinite(duration)||duration<=0)throw new Error('This file does not contain a readable video with a known duration.');
  const rotation=Number(stream.side_data_list?.find(x=>x.rotation!==undefined)?.rotation||stream.tags?.rotate||0);
  const sar=String(stream.sample_aspect_ratio||'1:1').split(':').map(Number);const aspect=sar[0]>0&&sar[1]>0?sar[0]/sar[1]:1;
  const rotated=Math.abs(rotation)%180===90;
  return {duration,width:Math.round(rotated?stream.height:stream.width*aspect),height:Math.round(rotated?stream.width*aspect:stream.height),codec:stream.codec_name,hasAudio:data.streams.some(s=>s.codec_type==='audio')};
}
async function nextJob(){
  if(running||stopping)return;const job=db.jobs.findLast(j=>j.status==='queued');if(!job)return;running=true;job.status='running';job.progress=0;
  try {
    await save();const video=find(db.videos,job.videoId,'Source video');const folder=path.join(DATA,'exports',job.id);await fs.mkdir(folder,{recursive:true});
    await fs.writeFile(path.join(folder,'hook.txt'),wrapHook(job.hookText));
    if(job.captions?.length)await fs.writeFile(path.join(folder,'captions.srt'),formatSrt(job.captions));
    for(const [i,line] of wrapHook(job.hookText).split('\n').entries())await fs.writeFile(path.join(folder,`hook-${i}.txt`),line);
    if((job.burnHook&&job.hookText)||(job.burnCaptions&&job.captions?.length)){if(!overlayFont)throw new Error('An overlay font is unavailable.');await fs.copyFile(overlayFont,path.join(folder,'font.ttf'));}
    if(job.burnCaptions&&job.captions?.length)await fs.writeFile(path.join(folder,'captions.ass'),captionAss(job.captions,job,video));
    const output=path.join(folder,'clip.mp4');
    const args=['-hide_banner','-y','-nostdin','-protocol_whitelist','file,pipe','-ss',String(job.start),'-i',path.join(DATA,'videos',video.file),'-t',String(job.end-job.start),'-map','0:v:0'];
    if(!job.mute)args.push('-map','0:a:0?');
    args.push('-vf',videoFilter(job,video),'-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-threads','2');
    if(job.mute)args.push('-an');else args.push('-c:a','aac','-b:a','160k');
    args.push('-movflags','+faststart','-progress','pipe:1','-nostats',output);
    await new Promise((resolve,reject)=>{
      const child=spawn(FFMPEG,args,{cwd:folder,windowsHide:true});processes.set(job.id,child);let err='',pending='';
      child.stdout.on('data',chunk=>{pending+=chunk;const lines=pending.split('\n');pending=lines.pop();for(const line of lines){const match=/^out_time_us=(\d+)/.exec(line);if(match)job.progress=Math.min(99,Math.round(Number(match[1])/1000000/(job.end-job.start)*100));}});
      child.stderr.on('data',d=>err=(err+d).slice(-6000));child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(err||'Export was interrupted.')));
    });
    if(job.status!=='cancelled'){job.status='done';job.progress=100;job.file=path.join(job.id,'clip.mp4');job.bytes=(await fs.stat(output)).size;job.completedAt=new Date().toISOString();}
  }catch(e){if(job.status!=='cancelled'){job.status='failed';job.error=engineReady?'The export could not finish. Check the source video and retry.':'FFmpeg is not installed or could not be started.';console.error('Export failed:',e.message);}}
  finally{processes.delete(job.id);running=false;await save().catch(console.error);setImmediate(nextJob);}
}

const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'");
  try{
    const host=req.headers.host||'';
    if(![`127.0.0.1:${PORT}`,`localhost:${PORT}`].includes(host))return json(res,403,{error:'Open this app from its localhost address.'});
    if(req.headers.origin&&!['http://'+host].includes(req.headers.origin))return json(res,403,{error:'Cross-site requests are not allowed.'});
    if(req.headers['sec-fetch-site']==='cross-site')return json(res,403,{error:'Cross-site requests are not allowed.'});
    const url=new URL(req.url,`http://${host}`),p=url.pathname;
    if(!['GET','HEAD'].includes(req.method)&&req.headers['x-hookcut']!=='1')return json(res,403,{error:'Missing local app request header.'});
    if(p==='/api/state'&&req.method==='GET')return json(res,200,{app:'hookcut',version:'1.1.0',hooks:db.hooks,videos:db.videos.map(publicVideo),jobs:db.jobs.map(publicJob),engineReady,captionBurnReady,transcription:transcription.snapshot(),maxUpload:MAX_UPLOAD});
    if(p==='/api/shutdown'&&req.method==='POST'){json(res,200,{ok:true});stopping=true;transcription.stop();for(const child of processes.values())child.kill();server.close();setTimeout(()=>saveChain.finally(()=>process.exit(0)),500);return;}
    if(p==='/api/demo'&&req.method==='POST'){const existing=db.videos.find(v=>v.demo);if(existing)return json(res,200,publicVideo(existing));if(!engineReady)throw new Error('Install FFmpeg to use demo footage.');const id=randomUUID(),file=id+'.mp4',full=path.join(DATA,'videos',file);await fs.copyFile(path.join(ROOT,'samples','practice.mp4'),full);const info=await probe(full);const video={id,file,name:'Practice footage.mp4',demo:true,bytes:(await fs.stat(full)).size,...info,createdAt:new Date().toISOString()};db.videos.unshift(video);await save();return json(res,201,publicVideo(video));}
    if(p==='/api/hooks'&&req.method==='POST'){const hook={...hookInput(await body(req)),id:randomUUID(),uses:0,starter:false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};db.hooks.unshift(hook);await save();return json(res,201,hook);}
    const hookMatch=/^\/api\/hooks\/([\w-]+)(\/use)?$/.exec(p);
    if(hookMatch&&!['backup','import'].includes(hookMatch[1])){const hook=find(db.hooks,hookMatch[1],'Hook');if(hookMatch[2]&&req.method==='POST'){hook.uses=(hook.uses||0)+1;await save();return json(res,200,hook);}if(req.method==='PUT'){Object.assign(hook,hookInput(await body(req)),{updatedAt:new Date().toISOString()});await save();return json(res,200,hook);}if(req.method==='DELETE'){db.hooks=db.hooks.filter(h=>h.id!==hook.id);await save();return json(res,200,{ok:true});}}
    if(p==='/api/hooks/backup'&&req.method==='GET'){res.setHeader('Content-Disposition','attachment; filename="hookcut-hooks.json"');return json(res,200,{app:'hookcut',version:1,exportedAt:new Date().toISOString(),hooks:db.hooks});}
    if(p==='/api/hooks/import'&&req.method==='POST'){const data=await body(req,32*1024**2);const rows=Array.isArray(data)?data:data.hooks;if(!Array.isArray(rows)||rows.length>5000)throw new Error('Choose a hook backup containing up to 5,000 hooks.');const validated=rows.map(hookInput);let added=0;const existing=new Set(db.hooks.map(h=>h.text.toLowerCase()));for(const row of validated){if(existing.has(row.text.toLowerCase()))continue;db.hooks.push({...row,id:randomUUID(),uses:0,starter:false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});existing.add(row.text.toLowerCase());added++;}await save();return json(res,200,{added,skipped:rows.length-added});}
    if(p==='/api/videos'&&req.method==='POST'){
      if(!engineReady)throw new Error('Install FFmpeg and FFprobe before importing videos.');
      if(Number(req.headers['content-length']||0)>MAX_UPLOAD)throw Object.assign(new Error('Choose a video smaller than 2 GB.'),{status:413});
      const name=cleanText(decodeURIComponent(req.headers['x-file-name']||'video.mp4'),240);const ext=path.extname(name).toLowerCase();
      if(!['.mp4','.mov','.mkv','.webm','.m4v','.avi'].includes(ext))throw new Error('Choose an MP4, MOV, MKV, WebM, M4V, or AVI video.');
      const id=randomUUID(),file=id+ext,full=path.join(DATA,'videos',file);let bytes=0;
      try{await pipeline(req,new Transform({transform(chunk,enc,cb){bytes+=chunk.length;if(bytes>MAX_UPLOAD)cb(new Error('Choose a video smaller than 2 GB.'));else cb(null,chunk);}}),createWriteStream(full,{flags:'wx'}));
        const info=await probe(full);const video={id,file,name,bytes,...info,createdAt:new Date().toISOString()};db.videos.unshift(video);await save();return json(res,201,publicVideo(video));
      }catch(e){await fs.unlink(full).catch(()=>{});throw new Error(e.message.includes('readable video')?e.message:'This video could not be imported. It may be damaged or unsupported.');}
    }
    if(p==='/api/transcription/model'&&req.method==='POST'){await transcription.install();return json(res,202,transcription.snapshot());}
    const transcriptMatch=/^\/api\/videos\/([\w-]+)\/transcribe(\/cancel)?$/.exec(p);
    if(transcriptMatch&&req.method==='POST'){const v=find(db.videos,transcriptMatch[1],'Video');if(transcriptMatch[2]){transcription.cancel(v.id);await save();return json(res,200,{ok:true});}const data=await body(req);return json(res,202,await transcription.start(v,data.language||'auto'));}
    const subtitleMatch=/^\/api\/videos\/([\w-]+)\/subtitles$/.exec(p);
    if(subtitleMatch){const v=find(db.videos,subtitleMatch[1],'Video');const file=path.join(DATA,'videos',v.id+'.captions.json');
      if(req.method!=='GET'&&transcription.busy(v.id))throw new Error('Wait for transcription to finish or cancel it before editing captions.');
      if(req.method==='GET'){const cues=v.subtitleCount?JSON.parse(await fs.readFile(file,'utf8')):[];return json(res,200,{name:v.subtitleName||'',cues});}
      if(req.method==='POST'){const data=await body(req);if(typeof data.text!=='string'||data.text.length>1024**2)throw new Error('Choose an SRT file smaller than 1 MB.');const cues=parseSrt(data.text);await fs.writeFile(file,JSON.stringify(cues));v.subtitleCount=cues.length;v.subtitleRevision=randomUUID();v.subtitleName=cleanText(data.name||'captions.srt',200);await save();return json(res,200,{name:v.subtitleName,cues});}
      if(req.method==='DELETE'){await fs.unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});delete v.subtitleCount;delete v.subtitleName;v.subtitleRevision=randomUUID();await save();return json(res,200,{ok:true});}
    }
    const videoMatch=/^\/api\/videos\/([\w-]+)$/.exec(p);
    if(videoMatch&&req.method==='DELETE'){const v=find(db.videos,videoMatch[1],'Video');if(transcription.busy(v.id))throw new Error('Cancel transcription before removing this source.');if(db.jobs.some(j=>j.videoId===v.id&&['queued','running'].includes(j.status)))throw new Error('Wait for exports to finish or cancel them before removing this source.');await fs.unlink(path.join(DATA,'videos',v.file)).catch(e=>{if(e.code!=='ENOENT')throw e;});await fs.unlink(path.join(DATA,'videos',v.id+'.captions.json')).catch(e=>{if(e.code!=='ENOENT')throw e;});db.videos=db.videos.filter(x=>x.id!==v.id);await save();return json(res,200,{ok:true});}
    if(p==='/api/jobs'&&req.method==='POST'){if(!engineReady)throw new Error('FFmpeg is unavailable.');const data=await body(req);const video=find(db.videos,data.videoId,'Video');const job={...clipInput(data,video),id:randomUUID(),videoId:video.id,sourceName:video.name,status:'queued',progress:0,createdAt:new Date().toISOString()};if(job.burnCaptions&&!captionBurnReady)throw new Error('This FFmpeg build does not support caption rendering.');if((job.includeSubtitles||job.burnCaptions)&&video.subtitleCount){const cues=JSON.parse(await fs.readFile(path.join(DATA,'videos',video.id+'.captions.json'),'utf8'));job.captions=trimCaptions(cues,job.start,job.end,job.subtitleOffset);job.subtitleCount=job.captions.length;}db.jobs.unshift(job);await save();setImmediate(nextJob);return json(res,201,publicJob(job));}
    const jobMatch=/^\/api\/jobs\/([\w-]+)(\/retry|\/cancel)?$/.exec(p);
    if(jobMatch){const j=find(db.jobs,jobMatch[1],'Export');if(req.method==='POST'&&jobMatch[2]==='/cancel'){if(!['running','queued'].includes(j.status))throw new Error('This export is no longer waiting or running.');j.status='cancelled';processes.get(j.id)?.kill();await save();return json(res,200,publicJob(j));}if(req.method==='POST'&&jobMatch[2]==='/retry'){if(!['failed','cancelled'].includes(j.status))throw new Error('Only failed or cancelled exports can be retried.');find(db.videos,j.videoId,'Source video');if(processes.has(j.id))throw new Error('The export is still stopping. Try again in a moment.');j.status='queued';j.progress=0;delete j.error;await save();setImmediate(nextJob);return json(res,200,publicJob(j));}if(req.method==='DELETE'){if(['queued','running'].includes(j.status)||processes.has(j.id))throw new Error('Cancel this export and wait for it to stop before removing it.');await fs.rm(path.join(DATA,'exports',j.id),{recursive:true,force:true});db.jobs=db.jobs.filter(x=>x.id!==j.id);await save();return json(res,200,{ok:true});}}
    const media=/^\/media\/([\w-]+)$/.exec(p);if(media&&['GET','HEAD'].includes(req.method)){const v=find(db.videos,media[1],'Video');const mime={'.webm':'video/webm','.mov':'video/quicktime','.mkv':'video/x-matroska','.avi':'video/x-msvideo'}[path.extname(v.file)]||'video/mp4';return await serveFile(req,res,path.join(DATA,'videos',v.file),mime);}
    const subtitleOutput=/^\/exports\/([\w-]+)\/subtitles$/.exec(p);if(subtitleOutput&&['GET','HEAD'].includes(req.method)){const j=find(db.jobs,subtitleOutput[1],'Export');if(j.status!=='done'||!j.subtitleCount)throw new Error('This clip does not have exported subtitles.');return await serveFile(req,res,path.join(DATA,'exports',j.id,'captions.srt'),'application/x-subrip; charset=utf-8',filename(j.title)+'.srt');}
    const output=/^\/exports\/([\w-]+)$/.exec(p);if(output&&['GET','HEAD'].includes(req.method)){const j=find(db.jobs,output[1],'Export');if(j.status!=='done')throw new Error('This export is not ready.');return await serveFile(req,res,path.join(DATA,'exports',j.file),'video/mp4',url.searchParams.has('download')?filename(j.title)+'.mp4':undefined);}
    if(['GET','HEAD'].includes(req.method)){const assets={'/':'index.html','/app.js':'app.js','/captions.js':'captions.js','/styles.css':'styles.css','/favicon.svg':'favicon.svg'};const asset=assets[p];if(asset){const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'}[path.extname(asset)];return await serveFile(req,res,path.join(ROOT,'public',asset),mime);}}
    json(res,404,{error:'Not found.'});
  }catch(e){if(!res.headersSent&&!res.destroyed)json(res,e.status||400,{error:e.message});}
});
server.requestTimeout=30*60*1000;
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`Port ${PORT} is already in use. Open http://127.0.0.1:${PORT} or set PORT to another number.`:e.message);process.exit(1);});
server.listen(PORT,'127.0.0.1',()=>console.log(`Hookcut is ready: http://127.0.0.1:${PORT}\nVideo engine: ${engineReady?'ready':'missing FFmpeg / FFprobe'}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;transcription.stop();for(const child of processes.values())child.kill();server.close();saveChain.finally(()=>process.exit(0));});

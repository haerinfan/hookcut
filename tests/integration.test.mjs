import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const work=path.resolve(root,'../../work');await fs.mkdir(work,{recursive:true});const temp=await fs.mkdtemp(path.join(work,'hookcut-test-'));
const port=44100+Math.floor(Math.random()*1000),base=`http://127.0.0.1:${port}`;
let server,logs='';
async function start(){server=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),HOOKCUT_DATA:path.join(temp,'data')},windowsHide:true});server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);for(let i=0;i<100;i++){try{if((await fetch(base+'/api/state')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error('Server did not start: '+logs);}
async function stop(){if(server&&!server.killed){const exited=new Promise(r=>server.once('exit',r));server.kill();await exited;}}
async function request(route,method='GET',body){const r=await fetch(base+route,{method,headers:{'X-Hookcut':'1',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
async function waitJob(id){for(let i=0;i<300;i++){const j=(await request('/api/state')).data.jobs.find(x=>x.id===id);if(['done','failed','cancelled'].includes(j.status))return j;await new Promise(r=>setTimeout(r,200));}throw new Error('Export timed out');}
test('end-to-end local workflow: hooks, uploads, real exports, persistence, and request isolation',{timeout:180000},async t=>{
 await start();t.after(stop);
 let initial=(await request('/api/state')).data;assert.equal(initial.hooks.length,30);assert.equal(initial.engineReady,true);
 await t.test('hook CRUD, portable backup, deduplication, and atomic import',async()=>{
  const create=await request('/api/hooks','POST',{text:'A real test hook <not markup>',category:'Story',niche:'Crypto',tags:'test, crypto',notes:'Testing persistence.'});assert.equal(create.status,201);const hook=create.data;
  assert.equal((await request('/api/hooks/'+hook.id,'PUT',{...hook,favorite:true})).data.favorite,true);
  assert.equal((await request('/api/hooks/'+hook.id+'/use','POST')).data.uses,1);
  const backup=await request('/api/hooks/backup');assert.equal(backup.status,200);assert.equal(backup.data.hooks.length,31);
  assert.equal((await request('/api/hooks/import','POST',backup.data)).data.added,0);
  assert.equal((await request('/api/hooks/import','POST',{hooks:[{text:'New imported hook'},{text:''}]})).status,400);
  assert.equal((await request('/api/state')).data.hooks.length,31);
  assert.equal((await request('/api/hooks/import','POST',{hooks:[{text:'Imported hook',category:'Tutorial'}]})).data.added,1);
  assert.equal((await request('/api/hooks/'+hook.id,'DELETE')).status,200);
 });
 await t.test('cross-site writes and private files are rejected',async()=>{
  assert.equal((await fetch(base+'/api/hooks',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"text":"blocked"}'})).status,403);
  assert.equal((await fetch(base+'/api/state',{headers:{Origin:'https://example.com'}})).status,403);
  assert.equal((await fetch(base+'/.data/library.json')).status,404);
  assert.equal((await fetch(base+'/server.mjs')).status,404);
 });
 const sample=path.join(temp,'sample.mp4');await exec('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=640x360:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','6','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac',sample],{windowsHide:true});
 const buffer=await fs.readFile(sample);let video;
 await t.test('video import, metadata, preview streaming, and invalid uploads',async()=>{
  const response=await fetch(base+'/api/videos',{method:'POST',headers:{'X-Hookcut':'1','X-File-Name':encodeURIComponent('Sample video.mp4')},body:buffer});assert.equal(response.status,201);video=await response.json();assert.equal(video.width,640);assert.equal(video.height,360);assert.equal(video.hasAudio,true);
  const range=await fetch(base+video.url,{headers:{Range:'bytes=0-99'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,100);
  const suffix=await fetch(base+video.url,{headers:{Range:'bytes=-32'}});assert.equal(suffix.status,206);assert.equal((await suffix.arrayBuffer()).byteLength,32);
  assert.equal((await fetch(base+video.url,{headers:{Range:'bytes=999999999-'}})).status,416);
  const bad=await fetch(base+'/api/videos',{method:'POST',headers:{'X-Hookcut':'1','X-File-Name':'bad.mp4'},body:'not a video'});assert.equal(bad.status,400);assert.equal((await request('/api/state')).data.videos.length,1);
  assert.equal((await request('/api/jobs','POST',{videoId:video.id,start:5,end:12})).status,400);
 });
 const completed=[];
 await t.test('imported captions are clipped, retimed, and captured at export time',async()=>{
  const srt='1\n00:00:00,000 --> 00:00:02,000\nFirst cue\n\n2\n00:00:02,500 --> 00:00:05,000\nSecond cue\n';
  const imported=await request('/api/videos/'+video.id+'/subtitles','POST',{name:'example.srt',text:srt});assert.equal(imported.status,200);assert.equal(imported.data.cues.length,2);
  assert.equal((await request('/api/videos/'+video.id+'/subtitles','POST',{name:'bad.srt',text:'bad'})).status,400);assert.equal((await request('/api/videos/'+video.id+'/subtitles')).data.cues.length,2);
  const j=(await request('/api/jobs','POST',{videoId:video.id,title:'Caption snapshot',start:1,end:4,format:'original',includeSubtitles:true,burnCaptions:true,subtitleOffset:.5})).data;assert.equal(j.subtitleCount,2);
  await request('/api/videos/'+video.id+'/subtitles','DELETE');const job=await waitJob(j.id);assert.equal(job.status,'done');const r=await fetch(base+'/exports/'+j.id+'/subtitles');assert.equal(r.status,200);const result=await r.text();assert.match(result,/00:00:00,000 --> 00:00:01,500/);assert.match(result,/00:00:02,000 --> 00:00:03,000/);assert.match(result,/Second cue/);await request('/api/jobs/'+j.id,'DELETE');
 });
 await t.test('saved moments, reusable presets, atomic batches, retries, and persistence',async()=>{
  const settings={videoId:video.id,title:'Saved opening',start:0,end:1,format:'original',quality:'720',includeSubtitles:true,notes:'A useful opening'};
  const p=await request('/api/presets','POST',{...settings,name:'My square preset',format:'square'});assert.equal(p.status,201);assert.equal(p.data.videoId,undefined);assert.equal(p.data.title,undefined);
  assert.equal((await request('/api/presets/starter-vertical','DELETE')).status,404);
  const one=await request('/api/moments','POST',settings),two=await request('/api/moments','POST',{...settings,title:'Second moment',start:2,end:3});assert.equal(one.status,201);assert.equal(two.status,201);
  assert.equal((await request('/api/moments','POST',{...settings,end:99})).status,400);
  assert.equal((await request('/api/moments/'+one.data.id,'PUT',{title:'Updated opening',notes:'Keep the payoff'})).data.title,'Updated opening');
  await stop();await start();const restored=(await request('/api/state')).data;assert.equal(restored.moments.length,2);assert.equal(restored.presets.find(x=>x.id===p.data.id).format,'square');
  const before=restored.jobs.length,requestId=crypto.randomUUID(),momentIds=[one.data.id,two.data.id];
  assert.equal((await request('/api/jobs/batch','POST',{requestId,momentIds:[one.data.id,'missing']})).status,404);
  assert.equal((await request('/api/state')).data.jobs.length,before);
  await request('/api/videos/'+video.id+'/subtitles','POST',{name:'batch.srt',text:'1\n00:00:00,000 --> 00:00:04,000\nBatch caption\n'});
  const batch=await request('/api/jobs/batch','POST',{requestId,momentIds});assert.equal(batch.status,201);assert.equal(batch.data.jobs.length,2);assert.equal(batch.data.jobs[0].title,'Updated opening');assert.equal(batch.data.jobs[0].subtitleCount,1);
  const again=await request('/api/jobs/batch','POST',{requestId,momentIds});assert.equal(again.data.reused,true);assert.deepEqual(again.data.jobs.map(j=>j.id),batch.data.jobs.map(j=>j.id));assert.equal((await request('/api/state')).data.jobs.length,before+2);
  assert.equal((await request('/api/jobs/batch','POST',{requestId,momentIds:[two.data.id]})).status,400);
  await request('/api/videos/'+video.id+'/subtitles','DELETE');
  for(const j of batch.data.jobs){assert.equal((await waitJob(j.id)).status,'done');assert.match(await (await fetch(base+'/exports/'+j.id+'/subtitles')).text(),/Batch caption/);}
  const activity=await request('/api/activity');assert.equal(typeof activity.data.revision,'number');assert.equal(activity.data.hooks,undefined);assert.equal(activity.data.jobs,undefined);assert.ok(JSON.stringify(activity.data).length<JSON.stringify((await request('/api/state')).data).length/2);
  for(const j of batch.data.jobs)await request('/api/jobs/'+j.id,'DELETE');
  assert.equal((await request('/api/jobs/batch','POST',{requestId,momentIds})).status,400);
  await request('/api/moments/'+two.data.id,'DELETE');assert.equal((await request('/api/state')).data.moments.length,1);
  await request('/api/presets/'+p.data.id,'DELETE');assert.equal((await request('/api/state')).data.presets.length,3);
 });
 await t.test('real vertical, square, and original exports with audio and text overlay',async()=>{
  for(const [format,fit,mute,burnHook,expected] of [['vertical','cover',false,true,[720,1280]],['square','contain',true,false,[720,720]],['original','cover',false,false,[640,360]]]){
   const queued=await request('/api/jobs','POST',{videoId:video.id,title:'Test '+format,start:1,end:3.5,format,fit,position:25,quality:'720',hookText:"A real hook: 100% focus, 'one' moment.",burnHook,mute});assert.equal(queued.status,201);
   const job=await waitJob(queued.data.id);assert.equal(job.status,'done',logs);const output=path.join(temp,format+'.mp4');const download=await fetch(base+job.url+'?download');assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/attachment/);await fs.writeFile(output,Buffer.from(await download.arrayBuffer()));
   const metadata=JSON.parse((await exec('ffprobe',['-v','error','-show_format','-show_streams','-of','json',output],{windowsHide:true})).stdout);const stream=metadata.streams.find(s=>s.codec_type==='video');assert.deepEqual([stream.width,stream.height],expected);assert.equal(stream.codec_name,'h264');assert.ok(Math.abs(Number(metadata.format.duration)-2.5)<.15);assert.equal(metadata.streams.some(s=>s.codec_type==='audio'),!mute);completed.push(job);
  }
 });
 await t.test('queue cancellation, retry, and source deletion protection',async()=>{
  const first=(await request('/api/jobs','POST',{videoId:video.id,title:'Cancel running',start:0,end:6,format:'vertical',quality:'1080'})).data;
  const second=(await request('/api/jobs','POST',{videoId:video.id,title:'Cancel queued',start:0,end:6,format:'square',quality:'1080'})).data;
  assert.equal((await request('/api/videos/'+video.id,'DELETE')).status,400);
  assert.equal((await request('/api/jobs/'+second.id+'/cancel','POST')).data.status,'cancelled');
  assert.equal((await request('/api/jobs/'+first.id+'/cancel','POST')).data.status,'cancelled');
  let retry;for(let i=0;i<20;i++){retry=await request('/api/jobs/'+first.id+'/retry','POST');if(retry.status===200)break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(retry.status,200);assert.equal((await waitJob(first.id)).status,'done');
  await request('/api/jobs/'+first.id,'DELETE');await request('/api/jobs/'+second.id,'DELETE');
 });
 await t.test('phone rotation metadata and silent video export',async()=>{
  const rotated=path.join(temp,'rotated.mov');await exec('ffmpeg',['-hide_banner','-loglevel','error','-y','-display_rotation','90','-i',sample,'-c:v','copy','-an',rotated],{windowsHide:true});
  const r=await fetch(base+'/api/videos',{method:'POST',headers:{'X-Hookcut':'1','X-File-Name':'rotated.mov'},body:await fs.readFile(rotated)});assert.equal(r.status,201);const v=await r.json();assert.deepEqual([v.width,v.height],[360,640]);assert.equal(v.hasAudio,false);
  const j=(await request('/api/jobs','POST',{videoId:v.id,title:'Rotated silent source',start:0,end:1,format:'original'})).data;assert.equal((await waitJob(j.id)).status,'done');
  const output=path.join(temp,'rotated-output.mp4');await fs.writeFile(output,Buffer.from(await (await fetch(base+'/exports/'+j.id)).arrayBuffer()));
  const m=JSON.parse((await exec('ffprobe',['-v','error','-show_streams','-of','json',output],{windowsHide:true})).stdout);assert.deepEqual([m.streams[0].width,m.streams[0].height],[360,640]);assert.equal(m.streams.length,1);
  await request('/api/jobs/'+j.id,'DELETE');await request('/api/videos/'+v.id,'DELETE');
 });
 await t.test('video trim bounds exclude a longer audio tail',async()=>{
  const file=path.join(temp,'long-audio.mp4');await exec('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',sample,'-f','lavfi','-i','sine=frequency=440:duration=10','-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac',file],{windowsHide:true});
  const r=await fetch(base+'/api/videos',{method:'POST',headers:{'X-Hookcut':'1','X-File-Name':'long-audio.mp4'},body:await fs.readFile(file)});assert.equal(r.status,201);const v=await r.json();assert.ok(Math.abs(v.duration-6)<.1);assert.equal((await request('/api/jobs','POST',{videoId:v.id,start:0,end:8})).status,400);await request('/api/videos/'+v.id,'DELETE');
 });
 await t.test('data survives a server restart and source removal preserves finished clips',async()=>{
  await stop();await start();const saved=(await request('/api/state')).data;assert.equal(saved.hooks.length,31);assert.equal(saved.jobs.filter(j=>j.status==='done').length,3);assert.equal(saved.videos.length,1);
  assert.equal((await request('/api/videos/'+video.id,'DELETE')).status,200);assert.equal((await fetch(base+completed[0].url)).status,200);assert.equal((await request('/api/state')).data.moments.length,0);
  assert.equal((await request('/api/jobs/'+completed[0].id,'DELETE')).status,200);assert.equal((await fetch(base+completed[0].url)).status,404);
 });
 console.log('Verified artifacts:',temp);
});

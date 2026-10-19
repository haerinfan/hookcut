import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('real local speech recognition, cancellation, caption preservation and persistence',{
  skip:!process.env.HOOKCUT_TEST_MODEL,
  timeout:180000,
},async t=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'hookcut-speech-'));
  const data=path.join(folder,'data');await fs.mkdir(path.join(data,'models'),{recursive:true});
  await fs.copyFile(process.env.HOOKCUT_TEST_MODEL,path.join(data,'models','ggml-tiny.bin'));
  const port=45200+Math.floor(Math.random()*500),base=`http://127.0.0.1:${port}`;
  const server=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),HOOKCUT_DATA:data},windowsHide:true,stdio:'ignore'});
  t.after(async()=>{const exited=new Promise(r=>server.once('exit',r));server.kill();await exited;await fs.rm(folder,{recursive:true,force:true});});
  async function request(route,method='GET',body){const r=await fetch(base+route,{method,headers:{'X-Hookcut':'1','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
  for(let i=0;i<100;i++){try{if((await request('/api/state')).status===200)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.equal((await request('/api/state')).data.transcription.model.status,'ready');
  const r=await fetch(base+'/api/videos',{method:'POST',headers:{'X-Hookcut':'1','X-File-Name':'spoken-demo.mp4'},body:await fs.readFile(path.join(root,'samples','speech-demo.mp4'))});const video=await r.json();assert.equal(r.status,201);
  const route='/api/videos/'+video.id;
  await request(route+'/subtitles','POST',{text:'1\n00:00:00,000 --> 00:00:01,000\nPreserve me\n'});
  assert.equal((await request(route+'/transcribe','POST',{language:'bad:filter'})).status,400);
  const first=await request(route+'/transcribe','POST',{language:'en'});assert.equal(first.status,202);
  assert.equal((await request(route+'/subtitles','DELETE')).status,400);
  assert.equal((await request(route,'DELETE')).status,400);
  assert.equal((await request(route+'/transcribe','POST',{language:'en'})).status,400);
  assert.equal((await request(route+'/transcribe/cancel','POST')).status,200);
  assert.equal((await request(route+'/subtitles')).data.cues[0].text,'Preserve me');
  let second;
  for(let i=0;i<50;i++){second=await request(route+'/transcribe','POST',{language:'en'});if(second.status===202)break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(second.status,202);
  let job;
  for(let i=0;i<600;i++){job=(await request('/api/state')).data.transcription.jobs.find(j=>j.id===second.data.id);if(job.status!=='running')break;await new Promise(r=>setTimeout(r,200));}
  assert.equal(job.status,'done',job.error);
  const cues=(await request(route+'/subtitles')).data.cues;
  assert.ok(cues.length>2);assert.match(cues.map(c=>c.text).join(' ').toLowerCase(),/strong opening/);
  assert.ok(cues.some(c=>c.start>20),'timestamps must continue across audio processing windows');
  assert.ok(cues.every(c=>c.start>=0&&c.end<=video.duration&&c.end>c.start));
  const persisted=JSON.parse(await fs.readFile(path.join(data,'videos',video.id+'.captions.json'),'utf8'));
  assert.deepEqual(persisted,cues);
});

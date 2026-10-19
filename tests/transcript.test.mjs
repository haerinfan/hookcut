import test from 'node:test';
import assert from 'node:assert/strict';
import {passageRange} from '../public/captions.js';
import {captionAss} from '../lib/caption-render.mjs';

test('passage selection includes intermediate lines, offsets and overlapping cue ends',()=>{
  const cues=[{start:0,end:4,text:'one'},{start:3,end:9,text:'two'},{start:5,end:6,text:'three'}];
  assert.deepEqual(passageRange(cues,2,0,8,.5),{start:.5,end:8,count:3});
  assert.deepEqual(passageRange(cues,0,0,8,-1),{start:0,end:3,count:1});
  assert.equal(passageRange(cues,null,1,8),null);
  assert.equal(passageRange(cues,0,0,8,10),null);
});
test('burned captions preserve timing and cannot inject ASS styling commands',()=>{
  const ass=captionAss([{start:.5,end:2.25,text:'A caption\n{\\pos(0,0)} 100%'}],{format:'vertical',quality:'720'},{width:1280,height:720});
  assert.match(ass,/PlayResX: 720\nPlayResY: 1280/);
  assert.match(ass,/0:00:00.50,0:00:02.25/);
  assert.ok(ass.includes('A caption\\N'));
  assert.ok(!ass.includes('{\\pos'));
});

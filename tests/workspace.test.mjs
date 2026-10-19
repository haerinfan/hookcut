import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {presetInput,momentInput,batchInput,STARTER_PRESETS} from '../lib/workspace.mjs';

test('presets retain only reusable settings, never clip content or source timing',()=>{
 const p=presetInput({name:' My preset ',title:'Private title',hookText:'Private hook',videoId:'private',start:99,end:101,notes:'private',subtitleOffset:55,format:'square',quality:'1080',position:20,burnCaptions:true});
 assert.deepEqual(Object.keys(p).sort(),['name','format','fit','position','quality','burnHook','mute','includeSubtitles','burnCaptions'].sort());
 assert.equal(p.name,'My preset');assert.equal(p.format,'square');assert.equal(p.burnCaptions,true);
 assert.throws(()=>presetInput({name:'  '}),/name/);assert.throws(()=>presetInput({name:'bad',position:101}),/position/);
 for(const preset of STARTER_PRESETS)assert.equal(presetInput(preset).name,preset.name);
});
test('saved moments enforce source bounds and preserve independent cut settings',()=>{
 const m=momentInput({title:'Opening',start:1,end:3,format:'original',notes:' Review wording ',hookText:'Hello',subtitleOffset:.5},{duration:4});
 assert.equal(m.notes,'Review wording');assert.equal(m.hookText,'Hello');assert.equal(m.subtitleOffset,.5);
 assert.throws(()=>momentInput({start:3,end:5},{duration:4}),/valid/);
 assert.throws(()=>momentInput({start:1,end:1.1},{duration:4}),/0.2/);
});
test('batch requests require unique selections, a bounded count, and a retry identifier',()=>{
 const requestId=randomUUID();assert.deepEqual(batchInput({momentIds:['one','two'],requestId}),{momentIds:['one','two'],requestId});
 for(const momentIds of [[],Array.from({length:21},(_,i)=>String(i)),['one','one'],[123]])assert.throws(()=>batchInput({momentIds,requestId}));
 assert.throws(()=>batchInput({momentIds:['one'],requestId:'bad'}));
});

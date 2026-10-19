import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSrt,trimCaptions,formatSrt,srtTime} from '../public/captions.js';
test('SRT parser accepts BOM, CRLF, multiline cues, and strips markup',()=>{const cues=parseSrt('\uFEFF1\r\n00:00:01,100 --> 00:00:03,250\r\n<i>Hello</i>\r\nworld\r\n\r\n2\r\n00:00:04.000 --> 00:00:05.000\r\nNext');assert.deepEqual(cues,[{start:1.1,end:3.25,text:'Hello\nworld'},{start:4,end:5,text:'Next'}]);});
test('SRT parser rejects malformed ranges without silently dropping them',()=>{for(const text of ['', '1\nnot a timestamp\nHello','1\n00:00:05,000 --> 00:00:01,000\nHello','1\n00:99:01,000 --> 00:99:02,000\nHello'])assert.throws(()=>parseSrt(text));});
test('subtitle trimming clamps boundary cues and rebases to clip zero',()=>{const cues=[{start:0,end:2,text:'Before'},{start:2,end:4,text:'Start'},{start:5,end:8,text:'End'},{start:8,end:10,text:'After'}];assert.deepEqual(trimCaptions(cues,3,7),[{start:0,end:1,text:'Start'},{start:2,end:4,text:'End'}]);});
test('caption timing offsets are applied before cropping',()=>{assert.deepEqual(trimCaptions([{start:0,end:1,text:'A'}],1,3,1.5),[{start:.5,end:1.5,text:'A'}]);assert.deepEqual(trimCaptions([{start:0,end:1,text:'A'}],1,3,-1),[]);});
test('exported SRT round-trips and time formatting carries milliseconds correctly',()=>{const cues=[{start:0,end:1.234,text:'First\nsecond'},{start:2.5,end:3,text:'Last'}];assert.deepEqual(parseSrt(formatSrt(cues)),cues);assert.equal(srtTime(59.9996),'00:01:00,000');});

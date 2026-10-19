import {clipInput, cleanText} from './core.mjs';

export const STARTER_PRESETS = [
  {id:'starter-vertical',name:'Vertical · captioned',format:'vertical',fit:'cover',position:50,quality:'720',burnHook:true,mute:false,includeSubtitles:true,burnCaptions:true,starter:true},
  {id:'starter-square',name:'Square · full frame',format:'square',fit:'contain',position:50,quality:'720',burnHook:false,mute:false,includeSubtitles:true,burnCaptions:false,starter:true},
  {id:'starter-landscape',name:'Landscape · 1080p',format:'landscape',fit:'contain',position:50,quality:'1080',burnHook:false,mute:false,includeSubtitles:true,burnCaptions:false,starter:true},
];
export function presetInput(data){
  const name=cleanText(data.name,60);if(!name)throw new Error('Give your preset a name.');
  const c=clipInput({...data,start:0,end:1,subtitleOffset:0},{duration:1});
  const {format,fit,position,quality,burnHook,mute,includeSubtitles,burnCaptions}=c;
  return {name,format,fit,position,quality,burnHook,mute,includeSubtitles,burnCaptions};
}
export function momentInput(data,video){
  const settings=clipInput(data,video);
  return {...settings,notes:cleanText(data.notes,1000)};
}
export function batchInput(data){
  if(!Array.isArray(data.momentIds)||!data.momentIds.length||data.momentIds.length>20)throw new Error('Select between 1 and 20 saved moments.');
  if(data.momentIds.some(id=>typeof id!=='string')||new Set(data.momentIds).size!==data.momentIds.length)throw new Error('Select each saved moment only once.');
  if(typeof data.requestId!=='string'||!/^[a-f0-9-]{36}$/i.test(data.requestId))throw new Error('This batch needs a valid request ID.');
  return {momentIds:data.momentIds,requestId:data.requestId};
}

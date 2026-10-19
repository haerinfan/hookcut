export function parseSrt(input) {
  const text=String(input).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim();
  if(!text)throw new Error('This subtitle file is empty.');
  const blocks=text.split(/\n\s*\n/),cues=[];
  if(blocks.length>10000)throw new Error('Use a subtitle file with at most 10,000 cues.');
  const time=value=>{const m=/^(\d{1,3}):(\d{2}):(\d{2})[,.](\d{1,3})$/.exec(value);if(!m||Number(m[2])>=60||Number(m[3])>=60)return NaN;return Number(m[1])*3600+Number(m[2])*60+Number(m[3])+Number(m[4].padEnd(3,'0'))/1000;};
  for(const [i,block] of blocks.entries()){
    const lines=block.split('\n');if(/^\d+$/.test(lines[0].trim()))lines.shift();
    const timing=/^\s*(\d{1,3}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,3}:\d{2}:\d{2}[,.]\d{1,3})(?:\s+.*)?$/.exec(lines.shift()||'');
    if(!timing)throw new Error(`Subtitle block ${i+1} has an invalid timestamp. Use an SRT file.`);
    const start=time(timing[1]),end=time(timing[2]);
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw new Error(`Subtitle block ${i+1} has an invalid time range.`);
    const content=lines.join('\n').replace(/<[^>]*>/g,'').trim();
    if(!content)continue;
    if(content.length>2000)throw new Error(`Subtitle block ${i+1} is too long.`);
    cues.push({start,end,text:content});
  }
  if(!cues.length)throw new Error('No readable subtitles were found.');
  return cues.sort((a,b)=>a.start-b.start);
}
export function trimCaptions(cues,start,end,offset=0){return cues.map(c=>({start:Math.round(Math.max(0,c.start+offset-start)*1000)/1000,end:Math.round(Math.min(end-start,c.end+offset-start)*1000)/1000,text:c.text})).filter(c=>c.end>c.start&&c.end>0&&c.start<end-start);}
export function srtTime(seconds){let ms=Math.max(0,Math.round(seconds*1000));const h=Math.floor(ms/3600000);ms%=3600000;const m=Math.floor(ms/60000);ms%=60000;const s=Math.floor(ms/1000);ms%=1000;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;}
export function formatSrt(cues){return cues.map((c,i)=>`${i+1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}`).join('\n\n')+'\n';}

export function passageRange(cues, first, last, duration, offset=0) {
  if (!Number.isInteger(first)||!Number.isInteger(last)||!cues[first]||!cues[last]) return null;
  const selected=cues.slice(Math.min(first,last),Math.max(first,last)+1);
  const start=Math.max(0,Math.min(...selected.map(c=>c.start))+offset);
  const end=Math.min(duration,Math.max(...selected.map(c=>c.end))+offset);
  return end-start>=.2 ? {start,end,count:selected.length} : null;
}

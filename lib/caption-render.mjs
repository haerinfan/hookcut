import {dimensions} from './core.mjs';

function assTime(seconds) {
  const cs = Math.max(0, Math.round(seconds * 100));
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}
export function captionAss(cues, clip, video) {
  const [w, h] = dimensions(clip, video).map(Math.round);
  const fontSize = Math.round(w * .04), margin = Math.round(w * .08);
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${w}\nPlayResY: ${h}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,${fontSize},&H00FFFFFF,&H00FFFFFF,&H80000000,&H80000000,0,0,0,0,100,100,0,0,3,${Math.max(2, Math.round(fontSize * .15))},0,2,${margin},${margin},${Math.round(h * .18)},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  // Prevent subtitle text from introducing ASS overrides or file references.
  return header + cues.map(c => {
    const text = c.text.replace(/\\/g, '＼').replace(/{/g, '｛').replace(/}/g, '｝').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').replace(/\n/g, '\\N');
    return `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${text}`;
  }).join('\n') + '\n';
}

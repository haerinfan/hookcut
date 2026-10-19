export const CATEGORIES = ['Curiosity', 'Story', 'Mistake', 'Contrarian', 'Tutorial', 'Question', 'Before & after', 'Challenge'];
export function cleanText(value, max = 500) { return String(value ?? '').trim().slice(0, max); }
export function hookInput(data) {
  if (String(data.text ?? '').trim().length>500) throw new Error('Each hook must be 500 characters or fewer.');
  const text = cleanText(data.text, 500);
  if (!text) throw new Error('Write a hook first.');
  const category = CATEGORIES.includes(data.category) ? data.category : 'Curiosity';
  const tags = (Array.isArray(data.tags) ? data.tags : String(data.tags || '').split(',')).map(t => cleanText(t, 30)).filter(Boolean).slice(0, 8);
  let source = cleanText(data.source, 1000);
  if (source && !/^https?:\/\//i.test(source)) throw new Error('Source links must start with https:// or http://.');
  return { text, category, niche: cleanText(data.niche || 'General', 50), tags: [...new Set(tags)], notes: cleanText(data.notes, 2000), source, favorite: !!data.favorite };
}
export function clipInput(data, video) {
  const start = Number(data.start), end = Number(data.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > video.duration + 0.05) throw new Error('Choose a valid start and end within the video.');
  if (end - start < 0.2) throw new Error('Clips must be at least 0.2 seconds long.');
  const format = ['original', 'vertical', 'square', 'landscape'].includes(data.format) ? data.format : 'vertical';
  const fit = data.fit === 'contain' ? 'contain' : 'cover';
  const position = Number(data.position ?? 50);
  if (!Number.isFinite(position) || position < 0 || position > 100) throw new Error('Crop position must be between 0 and 100.');
  const subtitleOffset = Number(data.subtitleOffset ?? 0);
  if (!Number.isFinite(subtitleOffset) || Math.abs(subtitleOffset)>3600) throw new Error('Caption offset must be between -3600 and 3600 seconds.');
  return { title: cleanText(data.title || 'Untitled clip', 100), start, end: Math.min(end, video.duration), format, fit, position, quality: data.quality === '1080' ? '1080' : '720', hookText: cleanText(data.hookText, 500), burnHook: !!data.burnHook, mute: !!data.mute, includeSubtitles: !!data.includeSubtitles, burnCaptions: !!data.burnCaptions, subtitleOffset };
}
export function dimensions(clip, video) {
  const h = Number(clip.quality);
  if (clip.format === 'vertical') return [h, h / 9 * 16];
  if (clip.format === 'square') return [h, h];
  if (clip.format === 'landscape') return [h / 9 * 16, h];
  const factor = Math.min(1, (h / 9 * 16) / Math.max(video.width, video.height));
  return [Math.max(2, Math.floor(video.width * factor / 2) * 2), Math.max(2, Math.floor(video.height * factor / 2) * 2)];
}
export function videoFilter(clip, video) {
  const [w, h] = dimensions(clip, video).map(Math.round);
  // Normalize non-square source pixels before applying the same geometry as the preview.
  const normal = `scale=trunc(iw*sar/2)*2:ih,setsar=1`;
  let filter = clip.fit === 'contain' || clip.format === 'original'
    ? `${normal},scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`
    : `${normal},scale=${w}:${h}:force_original_aspect_ratio=increase:force_divisible_by=2,crop=${w}:${h}:(iw-ow)*${clip.position / 100}:(ih-oh)*${clip.position / 100},setsar=1`;
  if (clip.burnHook && clip.hookText) {
    const size = Math.round(w * 0.046);
    for (const [i] of wrapHook(clip.hookText).split('\n').entries()) filter += `,drawtext=fontfile=font.ttf:textfile=hook-${i}.txt:expansion=none:fontcolor=white:fontsize=${size}:box=1:boxcolor=black@0.65:boxborderw=${Math.round(size * 0.25)}:x=(w-text_w)/2:y=h*0.14+${Math.round(i * size * 1.3)}:enable='lt(t,3)'`;
  }
  if (clip.burnCaptions && clip.captions?.length) filter += ',subtitles=captions.ass:fontsdir=.';
  return filter;
}
export function wrapHook(text, width = 34) {
  const words = text.replace(/\s+/g, ' ').trim().split(' '); const lines = []; let line = '';
  for (const word of words) {
    const chunks = word.match(new RegExp(`.{1,${width}}`, 'gu')) || [];
    for (const chunk of chunks) { if (line && (line + ' ' + chunk).length > width) { lines.push(line); line = ''; } line += (line ? ' ' : '') + chunk; }
  }
  if (line) lines.push(line);
  return lines.slice(0, 5).join('\n');
}
export function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!match || (!match[1] && !match[2])) return null;
  let start, end;
  if (!match[1]) { const suffix = Number(match[2]); if (suffix <= 0) return null; start = Math.max(0, size - suffix); end = size - 1; }
  else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null;
  return { start, end };
}
export function filename(title) { return cleanText(title, 80).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'clip'; }

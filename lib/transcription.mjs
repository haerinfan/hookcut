import path from 'node:path';
import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseSrt, trimCaptions } from '../public/captions.js';

// Fixed public model, verified against the upstream LFS SHA-256. No credentials.
export const MODEL = {
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
  sha256: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21',
  bytes: 77691713,
};
export const LANGUAGES = ['auto', 'en', 'tl', 'es', 'fr', 'de', 'pt', 'ja', 'ko', 'zh', 'hi', 'ar'];

export class Transcription {
  constructor({data, ffmpeg, supported, db, save}) {
    Object.assign(this, {data, ffmpeg, supported, db, save});
    this.model = {status: 'missing', progress: 0};
    this.jobs = db.transcriptions ||= [];
    for (const j of this.jobs) if (j.status === 'running') {
      j.status = 'failed'; j.error = 'The app stopped. Generate the transcript again.';
    }
    this.active = null;
  }
  async init() {
    this.modelFile = path.join(this.data, 'models', 'ggml-tiny.bin');
    try {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(this.modelFile)) hash.update(chunk);
      if (hash.digest('hex') === MODEL.sha256) this.model = {status: 'ready', progress: 100};
    } catch {}
  }
  snapshot() { return {supported: this.supported, model: this.model, jobs: this.jobs}; }
  busy(videoId) { return this.active?.videoId === videoId; }
  async install() {
    if (!this.supported) throw new Error('Use an FFmpeg build with the whisper filter to generate transcripts. SRT import still works.');
    if (['ready', 'downloading'].includes(this.model.status)) return;
    this.model = {status: 'downloading', progress: 0};
    this.download().catch(() => {});
  }
  async download() {
    const temporary = this.modelFile + '.partial';
    try {
      await fs.mkdir(path.dirname(this.modelFile), {recursive: true});
      const response = await fetch(MODEL.url, {signal: AbortSignal.timeout(15 * 60 * 1000)});
      if (!response.ok || !response.body) throw new Error('Download unavailable');
      let bytes = 0; const hash = createHash('sha256');
      await pipeline(Readable.fromWeb(response.body), new Transform({transform: (chunk, encoding, done) => {
        bytes += chunk.length;
        if (bytes > MODEL.bytes) return done(new Error('Unexpected model size'));
        hash.update(chunk); this.model.progress = Math.min(99, Math.floor(bytes / MODEL.bytes * 100)); done(null, chunk);
      }}), createWriteStream(temporary));
      if (bytes !== MODEL.bytes || hash.digest('hex') !== MODEL.sha256) throw new Error('Model verification failed');
      await fs.rename(temporary, this.modelFile);
      this.model = {status: 'ready', progress: 100};
    } catch {
      await fs.unlink(temporary).catch(() => {});
      this.model = {status: 'failed', progress: 0, error: 'Model download failed or verification did not match. Check your connection and retry.'};
    }
  }
  async start(video, language) {
    if (!this.supported || this.model.status !== 'ready') throw new Error('Download the local speech model first.');
    if (this.active) throw new Error('One transcript is already generating. Wait or cancel it first.');
    if (!video.hasAudio) throw new Error('This video has no audio track to transcribe.');
    if (!LANGUAGES.includes(language)) throw new Error('Choose a supported transcript language.');
    const job = {id: randomUUID(), videoId: video.id, status: 'running', progress: 0, language, createdAt: new Date().toISOString()};
    this.jobs.unshift(job); this.jobs.splice(50); this.active = job;
    await this.save();
    this.generate(job, video).catch(() => {});
    return job;
  }
  cancel(videoId) {
    if (!this.busy(videoId)) throw new Error('No transcript is generating for this source.');
    if (this.committing) throw new Error('The completed transcript is being saved.');
    this.active.status = 'cancelled'; this.child?.kill();
  }
  async generate(job, video) {
    const folder = path.join(this.data, 'transcriptions', job.id);
    try {
      await fs.mkdir(folder, {recursive: true});
      if (job.status === 'cancelled') return;
      // Bound the INPUT so EOF flushes the final speech window before output ends.
      const args = ['-hide_banner', '-nostdin', '-y', '-protocol_whitelist', 'file,pipe', '-t', String(video.duration), '-i', path.join(this.data, 'videos', video.file), '-map', '0:a:0', '-vn', '-af', `aresample=16000,whisper=model=../../models/ggml-tiny.bin:language=${job.language}:queue=20:use_gpu=false:destination=transcript.srt:format=srt`, '-progress', 'pipe:1', '-nostats', '-f', 'null', '-'];
      await new Promise((resolve, reject) => {
        const child = this.child = spawn(this.ffmpeg, args, {cwd: folder, windowsHide: true});
        let pending = '';
        child.stdout.on('data', chunk => {
          pending += chunk; const lines = pending.split('\n'); pending = lines.pop();
          for (const line of lines) { const m = /^out_time_us=(\d+)/.exec(line); if (m) job.progress = Math.min(99, Math.round(Number(m[1]) / 1000000 / video.duration * 100)); }
        });
        // Speech can appear in engine diagnostics; never write it to the server log.
        child.stderr.resume();
        child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error('Transcription failed')));
      });
      if (job.status === 'cancelled') return;
      const text = await fs.readFile(path.join(folder, 'transcript.srt'), 'utf8');
      if (!text.trim()) throw new Error('No speech was detected.');
      const cues = trimCaptions(parseSrt(text), 0, video.duration);
      if (!cues.length) throw new Error('No speech was detected.');
      if (job.status === 'cancelled') return;
      this.committing = true;
      const target = path.join(this.data, 'videos', video.id + '.captions.json');
      await fs.writeFile(target + '.tmp', JSON.stringify(cues));
      if (job.status === 'cancelled') { await fs.unlink(target + '.tmp'); return; }
      await fs.rename(target + '.tmp', target);
      video.subtitleCount = cues.length; video.subtitleName = 'Generated transcript'; video.subtitleRevision = randomUUID();
      job.status = 'done'; job.progress = 100; job.completedAt = new Date().toISOString();
    } catch (error) {
      if (job.status !== 'cancelled') { job.status = 'failed'; job.error = error.message === 'No speech was detected.' ? error.message : 'Transcription could not finish. Check the source audio and try again. Existing captions are preserved.'; }
    } finally {
      this.active = null; this.child = null; this.committing = false;
      // Only the UUID-owned temporary work directory is removed.
      await fs.rm(folder, {recursive: true, force: true}).catch(() => {});
      await this.save();
    }
  }
  stop() { this.child?.kill(); }
}

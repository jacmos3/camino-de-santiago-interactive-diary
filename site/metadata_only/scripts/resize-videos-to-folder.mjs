#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'assets', 'video');
const OUT_DIR = path.join(ROOT, 'assets', 'video_resized');

const MAX_SIDE = 960;
const CRF = 30;
const PRESET = 'veryslow';
const AUDIO_BITRATE = '96k';
const CONCURRENCY = 3;

const runFfmpeg = (args) => new Promise((resolve, reject) => {
  const proc = spawn('ffmpeg', ['-y', '-loglevel', 'error', ...args], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  proc.stderr.on('data', (chunk) => { stderr += String(chunk); });
  proc.on('error', reject);
  proc.on('close', (code) => {
    if (code === 0) resolve();
    else reject(new Error(stderr || `ffmpeg exit ${code}`));
  });
});

const pLimit = (concurrency) => {
  let active = 0;
  const queue = [];
  const next = () => {
    while (active < concurrency && queue.length > 0) {
      active += 1;
      const job = queue.shift();
      job().finally(() => {
        active -= 1;
        next();
      });
    }
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push(() => fn().then(resolve, reject));
    next();
  });
};

const entries = await fs.readdir(SRC_DIR, { withFileTypes: true });
const files = entries
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.mp4'))
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b));

await fs.mkdir(OUT_DIR, { recursive: true });

let done = 0;
let ok = 0;
let failed = 0;
let bytesIn = 0;
let bytesOut = 0;

console.log(`Found ${files.length} video files`);

const limit = pLimit(CONCURRENCY);
await Promise.all(files.map((name) => limit(async () => {
  const input = path.join(SRC_DIR, name);
  const output = path.join(OUT_DIR, name);
  const temp = `${output}.tmp.mp4`;
  try {
    const inStat = await fs.stat(input);
    bytesIn += inStat.size;
    await runFfmpeg([
      '-i', input,
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-vf', `scale='if(gte(iw,ih),min(iw,${MAX_SIDE}),-2)':'if(gte(iw,ih),-2,min(ih,${MAX_SIDE}))'`,
      '-c:v', 'libx264',
      '-preset', PRESET,
      '-crf', String(CRF),
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', AUDIO_BITRATE,
      '-movflags', '+faststart',
      temp
    ]);
    await fs.rename(temp, output);
    const outStat = await fs.stat(output);
    bytesOut += outStat.size;
    ok += 1;
  } catch (err) {
    try { await fs.unlink(temp); } catch {}
    failed += 1;
    console.error(`FAILED ${name}: ${err.message}`);
  } finally {
    done += 1;
    if (done % 10 === 0 || done === files.length) {
      console.log(`Progress ${done}/${files.length} (ok=${ok}, failed=${failed})`);
    }
  }
})));

const mb = (n) => (n / (1024 * 1024)).toFixed(1);
console.log(`Done. ok=${ok}, failed=${failed}`);
console.log(`Total size: ${mb(bytesIn)}MB -> ${mb(bytesOut)}MB`);

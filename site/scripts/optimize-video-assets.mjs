#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DATA_IT_JSON = path.join(ROOT, 'data', 'entries.it.json');
const DATA_EN_JSON = path.join(ROOT, 'data', 'entries.en.json');
const VIDEO_DIR = path.join(ROOT, 'assets', 'video');

const MAX_WIDTH = 1280;
const CRF = 27;
const PRESET = 'veryfast';
const CONCURRENCY = 2;

const runFfmpeg = (args) => new Promise((resolve, reject) => {
  const proc = spawn('ffmpeg', ['-y', '-loglevel', 'error', ...args], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
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
    while (active < concurrency && queue.length) {
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

const rel = (p) => p.split(path.sep).join('/');

const data = JSON.parse(await fs.readFile(DATA_IT_JSON, 'utf8'));

const byId = new Map();
for (const day of data.days || []) {
  for (const item of day.items || []) {
    if (item.type !== 'video' || !item.id || !item.src) continue;
    if (!byId.has(item.id)) byId.set(item.id, item.src);
  }
}

const videos = [...byId.entries()].map(([id, src]) => ({ id, src }));
console.log(`Video da ottimizzare: ${videos.length}`);

await fs.mkdir(VIDEO_DIR, { recursive: true });

const srcById = new Map();
let ok = 0;
let failed = 0;
let bytesBefore = 0;
let bytesAfter = 0;

const limit = pLimit(CONCURRENCY);
await Promise.all(videos.map((video, idx) => limit(async () => {
  const inputAbs = path.join(ROOT, video.src);
  const outputRel = `assets/video/vid_${video.id}.mp4`;
  const outputAbs = path.join(ROOT, outputRel);
  const tempAbs = `${outputAbs}.tmp.mp4`;

  try {
    const inStat = await fs.stat(inputAbs);
    bytesBefore += inStat.size;

    const baseArgs = [
      '-i', inputAbs,
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-vf', `scale='if(gt(iw,${MAX_WIDTH}),${MAX_WIDTH},iw)':-2`
    ];
    await runFfmpeg([
      ...baseArgs,
      '-c:v', 'libx264',
      '-preset', PRESET,
      '-crf', String(CRF),
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '96k',
      '-movflags', '+faststart',
      tempAbs
    ]);

    await fs.rename(tempAbs, outputAbs);
    const outStat = await fs.stat(outputAbs);
    bytesAfter += outStat.size;
    srcById.set(video.id, outputRel);
    ok += 1;
  } catch (err) {
    try { await fs.unlink(tempAbs); } catch {}
    srcById.set(video.id, video.src);
    failed += 1;
  }

  const done = idx + 1;
  if (done % 25 === 0 || done === videos.length) {
    console.log(`Progress ${done}/${videos.length} (ok=${ok}, failed=${failed})`);
  }
})));

const applySources = (payload) => {
  for (const day of payload.days || []) {
    for (const item of day.items || []) {
      if (item.type !== 'video' || !item.id) continue;
      item.src = srcById.get(item.id) || item.src;
      item.mime = 'video/mp4';
    }
  }
  return payload;
};

const dataIt = applySources(data);
const dataEn = applySources(JSON.parse(await fs.readFile(DATA_EN_JSON, 'utf8')));

await fs.writeFile(DATA_IT_JSON, `${JSON.stringify(dataIt, null, 2)}\n`);
await fs.writeFile(DATA_EN_JSON, `${JSON.stringify(dataEn, null, 2)}\n`);

const mb = (n) => (n / (1024 * 1024)).toFixed(1);
console.log(`Completato. ok=${ok}, failed=${failed}`);
if (bytesBefore > 0 && bytesAfter > 0) {
  console.log(`Size video transcodificati: ${mb(bytesBefore)}MB -> ${mb(bytesAfter)}MB`);
}

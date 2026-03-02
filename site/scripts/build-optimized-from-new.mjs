#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC_DIR = 'new';
const DATA_DIR = path.join(ROOT, 'data');
const VIDEO_OVERRIDES_PATH = path.join(DATA_DIR, 'video_include_overrides.txt');
const CAMINO_TIME_ZONE = 'Europe/Rome';
const ASSETS_DIR = path.join(ROOT, 'assets');
const IMG_DIR = path.join(ASSETS_DIR, 'img');
const THUMB_DIR = path.join(ASSETS_DIR, 'thumb');
const VIDEO_DIR = path.join(ASSETS_DIR, 'video');
const POSTER_DIR = path.join(ASSETS_DIR, 'poster');
const NOTES_PATH = path.join(DATA_DIR, 'notes.json');

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'tif', 'tiff']);
const VIDEO_EXTS = new Set(['mov', 'mp4', 'm4v']);

const MAX_IMAGE_SIDE = 2048;
const THUMB_SIDE = 640;
const IMG_JPEG_QUALITY = 4;
const THUMB_JPEG_QUALITY = 8;
const IMAGE_PARALLEL = 6;
const VIDEO_PARALLEL = 3;

const exifArgs = [
  '-api',
  'QuickTimeUTC=1',
  '-api',
  `TimeZone=${CAMINO_TIME_ZONE}`,
  '-json',
  '-n',
  '-q',
  '-q',
  '-r',
  ...[...IMAGE_EXTS, ...VIDEO_EXTS].flatMap((ext) => ['-ext', ext]),
  '-FileTypeExtension',
  '-MIMEType',
  '-DateTimeOriginal',
  '-CreateDate',
  '-MediaCreateDate',
  '-TrackCreateDate',
  '-ContentCreateDate',
  '-FileModifyDate',
  '-GPSLatitude',
  '-GPSLongitude',
  SRC_DIR,
];

const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, { cwd: ROOT, stdio: 'pipe', ...opts });
  let stderr = '';
  p.stderr.on('data', (chunk) => { stderr += String(chunk); });
  p.on('error', reject);
  p.on('close', (code) => {
    if (code === 0) resolve();
    else reject(new Error(`${cmd} ${args.join(' ')} failed (${code}) ${stderr.trim()}`));
  });
});

const ensureDir = async (dir) => fs.mkdir(dir, { recursive: true });

const parseExifDate = (raw) => {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})(?:([+-]\d{2}):?(\d{2}))?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, offH, offM] = m;
  const date = `${y}-${mo}-${d}`;
  const time = `${h}:${mi}:${s}`;
  const isoLocal = `${date}T${time}`;
  let sortTs = Date.parse(`${date}T${time}`);
  if (offH && offM) {
    const sign = offH.startsWith('-') ? '-' : '+';
    const hh = offH.replace(/[+-]/, '').padStart(2, '0');
    const mm = String(offM).padStart(2, '0');
    sortTs = Date.parse(`${date}T${time}${sign}${hh}:${mm}`);
  }
  if (Number.isNaN(sortTs)) sortTs = 0;
  return { date, time, isoLocal, sortTs };
};

const bestDate = (row) => {
  const keys = ['DateTimeOriginal', 'CreateDate', 'MediaCreateDate', 'TrackCreateDate', 'ContentCreateDate', 'FileModifyDate'];
  for (const key of keys) {
    const parsed = parseExifDate(row[key]);
    if (parsed) return parsed;
  }
  return null;
};

const pLimit = (concurrency) => {
  let active = 0;
  const queue = [];
  const next = () => {
    while (active < concurrency && queue.length) {
      active += 1;
      const task = queue.shift();
      task().finally(() => {
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

const toWebPath = (p) => p.split(path.sep).join('/');

const exif = await new Promise((resolve, reject) => {
  const p = spawn('exiftool', exifArgs, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  p.stdout.on('data', (c) => { out += String(c); });
  p.stderr.on('data', (c) => { err += String(c); });
  p.on('error', reject);
  p.on('close', (code) => {
    if (code !== 0) reject(new Error(err || `exiftool exit ${code}`));
    else resolve(out);
  });
});

const rows = JSON.parse(exif || '[]');

await Promise.all([ensureDir(IMG_DIR), ensureDir(THUMB_DIR), ensureDir(VIDEO_DIR), ensureDir(POSTER_DIR), ensureDir(DATA_DIR)]);

let notesByDate = {};
try {
  notesByDate = JSON.parse(await fs.readFile(NOTES_PATH, 'utf8')) || {};
} catch {
  notesByDate = {};
}

let videoIncludeOverrides = new Set();
try {
  const raw = await fs.readFile(VIDEO_OVERRIDES_PATH, 'utf8');
  videoIncludeOverrides = new Set(
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.toLowerCase())
  );
} catch {
  videoIncludeOverrides = new Set();
}

const media = [];
for (const row of rows) {
  const source = row.SourceFile;
  if (!source || typeof source !== 'string') continue;
  if (!source.startsWith(`${SRC_DIR}/`) && !source.startsWith(`${SRC_DIR}${path.sep}`)) continue;

  const date = bestDate(row);
  if (!date) continue;

  const fileName = path.basename(source);
  const ext = String(row.FileTypeExtension || path.extname(fileName).slice(1)).toLowerCase();
  const rel = toWebPath(source);
  const id = createHash('sha1').update(rel).digest('hex').slice(0, 12);
  const isImage = IMAGE_EXTS.has(ext);
  const isVideo = VIDEO_EXTS.has(ext);
  if (!isImage && !isVideo) continue;

  const stem = fileName.replace(/\.[^.]+$/, '');
  media.push({ row, source, rel, fileName, stem, ext, id, date, isImage, isVideo });
}

media.sort((a, b) => (a.date.sortTs - b.date.sortTs) || a.fileName.localeCompare(b.fileName));

const imageTasks = media.filter((m) => m.isImage);
const imageContentIdByStem = new Map();
for (const img of imageTasks) {
  const stem = img.stem.toLowerCase();
  if (!imageContentIdByStem.has(stem)) imageContentIdByStem.set(stem, new Set());
  if (img.row.ContentIdentifier) imageContentIdByStem.get(stem).add(String(img.row.ContentIdentifier));
}
const isLivePhotoCompanionVideo = (m) => {
  if (!m.isVideo) return false;
  const stem = m.stem.toLowerCase();
  const imageCidSet = imageContentIdByStem.get(stem);
  if (!imageCidSet || !imageCidSet.size) return false;
  const videoCid = m.row.ContentIdentifier ? String(m.row.ContentIdentifier) : null;
  if (!videoCid) return false;
  return imageCidSet.has(videoCid);
};
const livePhotoVideoTasks = media.filter(
  (m) => m.isVideo && isLivePhotoCompanionVideo(m) && !videoIncludeOverrides.has(m.fileName.toLowerCase())
);
const trueVideoTasks = media.filter(
  (m) => m.isVideo && (!isLivePhotoCompanionVideo(m) || videoIncludeOverrides.has(m.fileName.toLowerCase()))
);

console.log(
  `Found ${media.length} media (${imageTasks.length} images, ${trueVideoTasks.length} videos, ${livePhotoVideoTasks.length} live-photo videos skipped)`
);

const imageLimit = pLimit(IMAGE_PARALLEL);
let doneImages = 0;
let doneVideos = 0;

await Promise.all(imageTasks.map((m) => imageLimit(async () => {
  const inAbs = path.join(ROOT, m.source);
  const outImg = path.join(IMG_DIR, `img_${m.id}.jpg`);
  const outThumb = path.join(THUMB_DIR, `thumb_${m.id}.jpg`);

  try {
    // Prefer sips on macOS to avoid extracting low-res square previews from some HEIC files.
    await run('sips', ['-s', 'format', 'jpeg', inAbs, '--out', outImg]);
    await run('sips', ['-s', 'formatOptions', 'best', outImg]);
    await run('sips', ['-Z', String(MAX_IMAGE_SIDE), outImg]);
    await fs.copyFile(outImg, outThumb);
    await run('sips', ['-s', 'formatOptions', 'high', outThumb]);
    await run('sips', ['-Z', String(THUMB_SIDE), outThumb]);
  } catch {
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', inAbs, '-vf', `scale='if(gt(iw,ih),min(${MAX_IMAGE_SIDE},iw),-2)':'if(gt(iw,ih),-2,min(${MAX_IMAGE_SIDE},ih))'`, '-q:v', String(IMG_JPEG_QUALITY), outImg]);
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', inAbs, '-vf', `scale='if(gt(iw,ih),min(${THUMB_SIDE},iw),-2)':'if(gt(iw,ih),-2,min(${THUMB_SIDE},ih))'`, '-q:v', String(THUMB_JPEG_QUALITY), outThumb]);
  }

  doneImages += 1;
  if (doneImages % 100 === 0 || doneImages === imageTasks.length) {
    console.log(`Images ${doneImages}/${imageTasks.length}`);
  }
})));

const videoLimit = pLimit(VIDEO_PARALLEL);
await Promise.all(trueVideoTasks.map((m) => videoLimit(async () => {
  const inAbs = path.join(ROOT, m.source);
  const outVideoName = `vid_${m.id}.${m.ext}`;
  const outVideo = path.join(VIDEO_DIR, outVideoName);
  const outPoster = path.join(POSTER_DIR, `poster_${m.id}.jpg`);

  await fs.copyFile(inAbs, outVideo);

  try {
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '00:00:00.500', '-i', inAbs, '-frames:v', '1', '-q:v', '4', outPoster]);
  } catch {
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', inAbs, '-frames:v', '1', '-q:v', '4', outPoster]);
  }

  doneVideos += 1;
  if (doneVideos % 100 === 0 || doneVideos === trueVideoTasks.length) {
    console.log(`Videos ${doneVideos}/${trueVideoTasks.length}`);
  }
})));

const items = [];
const gpsPoints = [];

for (const m of media) {
  if (m.isVideo && isLivePhotoCompanionVideo(m) && !videoIncludeOverrides.has(m.fileName.toLowerCase())) {
    continue;
  }
  const item = {
    id: m.id,
    type: m.isImage ? 'image' : 'video',
    date: m.date.date,
    time: m.date.time.slice(0, 5),
    src: m.isImage
      ? `assets/img/img_${m.id}.jpg`
      : `assets/video/vid_${m.id}.${m.ext}`,
    thumb: m.isImage ? `assets/thumb/thumb_${m.id}.jpg` : null,
    poster: m.isVideo ? `assets/poster/poster_${m.id}.jpg` : null,
    mime: m.isImage ? 'image/jpeg' : (m.ext === 'mov' ? 'video/quicktime' : m.ext === 'm4v' ? 'video/x-m4v' : 'video/mp4'),
    size: null,
    orig: m.fileName,
    _sortTs: m.date.sortTs,
  };
  items.push(item);

  const lat = m.row.GPSLatitude;
  const lon = m.row.GPSLongitude;
  if (typeof lat === 'number' && typeof lon === 'number') {
    gpsPoints.push({ lat, lon, time: m.date.isoLocal, file: m.fileName, date: m.date.date, _sortTs: m.date.sortTs });
  }
}

items.sort((a, b) => (a._sortTs - b._sortTs) || a.orig.localeCompare(b.orig));
gpsPoints.sort((a, b) => (a._sortTs - b._sortTs) || a.file.localeCompare(b.file));

const byDay = new Map();
for (const item of items) {
  if (!byDay.has(item.date)) byDay.set(item.date, []);
  const clean = { ...item };
  delete clean._sortTs;
  byDay.get(item.date).push(clean);
}

const daysSorted = [...byDay.keys()].sort();
const days = daysSorted.map((date) => ({ date, items: byDay.get(date), notes: notesByDate[date] || {} }));

const counts = {
  images: items.filter((x) => x.type === 'image').length,
  videos: items.filter((x) => x.type === 'video').length,
  live: livePhotoVideoTasks.length,
};

const entries = { generated_at: new Date().toISOString(), days, counts };

const trackByDay = {};
for (const p of gpsPoints) {
  if (!trackByDay[p.date]) trackByDay[p.date] = [];
  trackByDay[p.date].push({ lat: p.lat, lon: p.lon, time: p.time, file: p.file });
}

const lineCoords = gpsPoints.map((p) => [p.lon, p.lat]);
const features = [];
if (lineCoords.length >= 2) {
  features.push({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: lineCoords },
    properties: { points: lineCoords.length },
  });
}
for (const p of gpsPoints) {
  features.push({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: { time: p.time, file: p.file, date: p.date },
  });
}

const trackGeo = { type: 'FeatureCollection', features };
const trackPoints = gpsPoints.map(({ _sortTs, ...rest }) => rest);

await fs.writeFile(path.join(DATA_DIR, 'entries.json'), `${JSON.stringify(entries, null, 2)}\n`);
await fs.writeFile(path.join(DATA_DIR, 'entries.js'), `window.__CAMMINO_ENTRIES__ = ${JSON.stringify(entries, null, 2)};\n`);
await fs.writeFile(path.join(DATA_DIR, 'track_by_day.json'), `${JSON.stringify(trackByDay, null, 2)}\n`);
await fs.writeFile(path.join(DATA_DIR, 'track_points.json'), `${JSON.stringify(trackPoints, null, 2)}\n`);
await fs.writeFile(path.join(DATA_DIR, 'track.geojson'), `${JSON.stringify(trackGeo, null, 2)}\n`);

console.log(`Done. Days=${days.length}, items=${items.length}, gps=${trackPoints.length}`);

#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC_DIR = 'new';
const DATA_DIR = path.join(ROOT, 'data');
const NOTES_PATH = path.join(DATA_DIR, 'notes.json');
const CAMINO_TIME_ZONE = 'Europe/Rome';

const EXTS = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'tif', 'tiff', 'mov', 'mp4', 'm4v'];

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
  ...EXTS.flatMap((ext) => ['-ext', ext]),
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

const exif = spawnSync('exiftool', exifArgs, {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 512,
});

if (exif.status !== 0) {
  console.error(exif.stderr || 'exiftool failed');
  process.exit(exif.status || 1);
}

const rows = JSON.parse(exif.stdout || '[]');

const parseExifDate = (raw) => {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(
    /^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})(?:([+-]\d{2}):?(\d{2}))?$/,
  );
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

const getBestDate = (row) => {
  const keys = [
    'DateTimeOriginal',
    'CreateDate',
    'MediaCreateDate',
    'TrackCreateDate',
    'ContentCreateDate',
    'FileModifyDate',
  ];
  for (const key of keys) {
    const parsed = parseExifDate(row[key]);
    if (parsed) return parsed;
  }
  return null;
};

const extToType = (ext, mime) => {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('image/')) return 'image';
  const e = (ext || '').toLowerCase();
  if (['mov', 'mp4', 'm4v'].includes(e)) return 'video';
  return 'image';
};

const extToMime = (ext, fallback) => {
  if (fallback) return fallback;
  const e = (ext || '').toLowerCase();
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
  if (e === 'png') return 'image/png';
  if (e === 'heic') return 'image/heic';
  if (e === 'heif') return 'image/heif';
  if (e === 'webp') return 'image/webp';
  if (e === 'mov') return 'video/quicktime';
  if (e === 'mp4') return 'video/mp4';
  if (e === 'm4v') return 'video/x-m4v';
  return 'application/octet-stream';
};

const toWebPath = (sourceFile) => sourceFile.split(path.sep).join('/');

let notesByDate = {};
try {
  notesByDate = JSON.parse(await fs.readFile(NOTES_PATH, 'utf8')) || {};
} catch {
  notesByDate = {};
}

const items = [];
const gpsPoints = [];

for (const row of rows) {
  const sourceFile = row.SourceFile;
  if (!sourceFile || typeof sourceFile !== 'string') continue;
  if (!sourceFile.startsWith(`${SRC_DIR}${path.sep}`) && !sourceFile.startsWith(`${SRC_DIR}/`)) continue;

  const parsedDate = getBestDate(row);
  if (!parsedDate) continue;

  const fileName = path.basename(sourceFile);
  const ext = (row.FileTypeExtension || path.extname(fileName).replace('.', '')).toLowerCase();
  const mime = extToMime(ext, row.MIMEType || null);
  const type = extToType(ext, mime);
  const rel = toWebPath(sourceFile);
  const id = createHash('sha1').update(rel).digest('hex').slice(0, 12);

  const item = {
    id,
    type,
    date: parsedDate.date,
    time: parsedDate.time.slice(0, 5),
    src: encodeURI(rel).replace(/#/g, '%23'),
    thumb: type === 'image' ? encodeURI(rel).replace(/#/g, '%23') : null,
    poster: null,
    mime,
    size: null,
    orig: fileName,
    _sortTs: parsedDate.sortTs,
  };

  items.push(item);

  if (typeof row.GPSLatitude === 'number' && typeof row.GPSLongitude === 'number') {
    gpsPoints.push({
      lat: row.GPSLatitude,
      lon: row.GPSLongitude,
      time: parsedDate.isoLocal,
      file: fileName,
      date: parsedDate.date,
      _sortTs: parsedDate.sortTs,
    });
  }
}

items.sort((a, b) => {
  if (a._sortTs !== b._sortTs) return a._sortTs - b._sortTs;
  return a.orig.localeCompare(b.orig);
});

gpsPoints.sort((a, b) => {
  if (a._sortTs !== b._sortTs) return a._sortTs - b._sortTs;
  return a.file.localeCompare(b.file);
});

const daysMap = new Map();
for (const item of items) {
  if (!daysMap.has(item.date)) daysMap.set(item.date, []);
  const clean = { ...item };
  delete clean._sortTs;
  daysMap.get(item.date).push(clean);
}

const dayDates = [...daysMap.keys()].sort();
const days = dayDates.map((date) => ({
  date,
  items: daysMap.get(date),
  notes: notesByDate[date] || {},
}));

const counts = {
  images: items.filter((it) => it.type === 'image').length,
  videos: items.filter((it) => it.type === 'video').length,
  live: 0,
};

const entries = {
  generated_at: new Date().toISOString(),
  days,
  counts,
};

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

const geojson = {
  type: 'FeatureCollection',
  features,
};

await fs.writeFile(path.join(DATA_DIR, 'entries.json'), `${JSON.stringify(entries, null, 2)}\n`);
await fs.writeFile(path.join(DATA_DIR, 'entries.js'), `window.__CAMMINO_ENTRIES__ = ${JSON.stringify(entries, null, 2)};\n`);
await fs.writeFile(path.join(DATA_DIR, 'track_points.json'), `${JSON.stringify(gpsPoints.map(({ _sortTs, ...p }) => p), null, 2)}\n`);
await fs.writeFile(path.join(DATA_DIR, 'track_by_day.json'), `${JSON.stringify(trackByDay, null, 2)}\n`);
await fs.writeFile(path.join(DATA_DIR, 'track.geojson'), `${JSON.stringify(geojson, null, 2)}\n`);

console.log(`Built data from ${SRC_DIR}/`);
console.log(`Days: ${days.length}`);
console.log(`Items: ${items.length} (images: ${counts.images}, videos: ${counts.videos})`);
console.log(`GPS points: ${gpsPoints.length}`);

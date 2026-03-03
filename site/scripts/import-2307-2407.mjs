#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SOURCES = [
  { dir: path.join(ROOT, 'assets', '23_07_2019'), dateFallback: '2019-07-23' },
  { dir: path.join(ROOT, 'assets', '24_07_2019'), dateFallback: '2019-07-24' }
];

const ASSETS = {
  img: path.join(ROOT, 'assets', 'img'),
  thumb: path.join(ROOT, 'assets', 'thumb'),
  poster: path.join(ROOT, 'assets', 'poster'),
  video: path.join(ROOT, 'assets', 'video_resized')
};

const IT_PATH = path.join(ROOT, 'data', 'entries.it.json');
const EN_PATH = path.join(ROOT, 'data', 'entries.en.json');
const REPORT_PATH = path.join(ROOT, 'data', 'import_2307_2407_report.json');

const IMAGE_MAX = 2048;
const THUMB_MAX = 640;
const POSTER_MAX = 1280;

const exists = async (p) => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'ignore' });

const exifJson = (input) => {
  try {
    const out = execFileSync('exiftool', ['-j', input], { encoding: 'utf8' });
    const arr = JSON.parse(out);
    return Array.isArray(arr) && arr.length ? arr[0] : {};
  } catch {
    return {};
  }
};

const extractDateTime = (meta, fileName, fallbackDate) => {
  const byName = String(fileName).match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/);
  if (byName) {
    return {
      date: `${byName[1]}-${byName[2]}-${byName[3]}`,
      time: `${byName[4]}:${byName[5]}`
    };
  }

  const raw =
    meta.DateTimeOriginal
    || meta.CreateDate
    || meta.MediaCreateDate
    || meta.TrackCreateDate
    || '';
  const m = String(raw).match(/(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (m) {
    return {
      date: `${m[1]}-${m[2]}-${m[3]}`,
      time: `${m[4]}:${m[5]}`
    };
  }

  return { date: fallbackDate, time: '' };
};

const parseGps = (meta) => {
  const lat = Number(meta.GPSLatitude);
  const lon = Number(meta.GPSLongitude);
  if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  return null;
};

const ensureDay = (payload, date) => {
  if (!Array.isArray(payload.days)) payload.days = [];
  let day = payload.days.find((d) => String(d.date) === String(date));
  if (!day) {
    day = { date, items: [], notes: '', recommendations: [] };
    payload.days.push(day);
    payload.days.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }
  if (!Array.isArray(day.items)) day.items = [];
  if (typeof day.notes !== 'string') day.notes = '';
  if (!Array.isArray(day.recommendations)) day.recommendations = [];
  return day;
};

const minuteKey = (t) => {
  const m = String(t || '').match(/(\d{2}):(\d{2})/);
  if (!m) return Number.POSITIVE_INFINITY;
  return Number(m[1]) * 60 + Number(m[2]);
};

const sortItemsByTime = (items) => {
  items.sort((a, b) => {
    const ka = minuteKey(a.time);
    const kb = minuteKey(b.time);
    if (ka !== kb) return ka - kb;
    return String(a.orig || '').localeCompare(String(b.orig || ''));
  });
};

const makeImageAssets = async (srcAbs, id) => {
  const outImg = path.join(ASSETS.img, `img_${id}.jpg`);
  const outThumb = path.join(ASSETS.thumb, `thumb_${id}.jpg`);
  if (!(await exists(outImg))) {
    run('sips', ['-s', 'format', 'jpeg', srcAbs, '--out', outImg]);
    run('sips', ['-s', 'formatOptions', 'best', outImg]);
    run('sips', ['-Z', String(IMAGE_MAX), outImg]);
  }
  if (!(await exists(outThumb))) {
    await fs.copyFile(outImg, outThumb);
    run('sips', ['-s', 'formatOptions', 'high', outThumb]);
    run('sips', ['-Z', String(THUMB_MAX), outThumb]);
  }
  return {
    src: `assets/img/img_${id}.jpg`,
    thumb: `assets/thumb/thumb_${id}.jpg`
  };
};

const makeVideoAssets = async (srcAbs, id) => {
  const outVid = path.join(ASSETS.video, `vid_${id}.mp4`);
  const outPoster = path.join(ASSETS.poster, `poster_${id}.jpg`);
  if (!(await exists(outVid))) {
    run('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-i', srcAbs,
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-vf', "scale='if(gt(iw,1280),1280,iw)':-2",
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '27',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outVid
    ]);
  }
  if (!(await exists(outPoster))) {
    run('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-ss', '00:00:01',
      '-i', outVid,
      '-frames:v', '1',
      '-vf', `scale='if(gt(iw,ih),min(${POSTER_MAX},iw),-2)':'if(gt(iw,ih),-2,min(${POSTER_MAX},ih))'`,
      outPoster
    ]);
  }
  return {
    src: `assets/video_resized/vid_${id}.mp4`,
    poster: `assets/poster/poster_${id}.jpg`
  };
};

const recalcCounts = (payload) => {
  let images = 0;
  let videos = 0;
  let live = 0;
  for (const day of payload.days || []) {
    for (const item of day.items || []) {
      if (item.type === 'video') videos += 1;
      else images += 1;
      if (item.live) live += 1;
    }
  }
  payload.counts = { images, videos, live };
  payload.generated_at = new Date().toISOString();
};

const main = async () => {
  const it = JSON.parse(await fs.readFile(IT_PATH, 'utf8'));
  const en = JSON.parse(await fs.readFile(EN_PATH, 'utf8'));

  for (const p of Object.values(ASSETS)) await fs.mkdir(p, { recursive: true });

  const existingOrig = new Set();
  for (const day of it.days || []) {
    for (const item of day.items || []) {
      const key = String(item.orig || '').toLowerCase();
      if (key) existingOrig.add(key);
    }
  }

  const report = { imported: [], skipped: [] };

  for (const src of SOURCES) {
    if (!(await exists(src.dir))) continue;
    const files = (await fs.readdir(src.dir))
      .filter((f) => /\.(jpe?g|png|heic|mp4|mov|m4v)$/i.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    for (const file of files) {
      const lower = file.toLowerCase();
      if (existingOrig.has(lower)) {
        report.skipped.push({ file, reason: 'already_present' });
        continue;
      }

      const abs = path.join(src.dir, file);
      const relSeed = path.relative(ROOT, abs).split(path.sep).join('/');
      const id = createHash('sha1').update(relSeed).digest('hex').slice(0, 12);
      const meta = exifJson(abs);
      const { date, time } = extractDateTime(meta, file, src.dateFallback);
      const gps = parseGps(meta);

      const isVideo = /\.(mp4|mov|m4v)$/i.test(file);
      let item;
      if (isVideo) {
        const out = await makeVideoAssets(abs, id);
        item = {
          id,
          type: 'video',
          date,
          time,
          src: out.src,
          thumb: null,
          poster: out.poster,
          mime: 'video/mp4',
          size: null,
          orig: file
        };
      } else {
        const out = await makeImageAssets(abs, id);
        item = {
          id,
          type: 'image',
          date,
          time,
          src: out.src,
          thumb: out.thumb,
          poster: null,
          mime: 'image/jpeg',
          size: null,
          orig: file
        };
      }

      if (gps) {
        item.lat = gps.lat;
        item.lon = gps.lon;
        item.gpsInferred = false;
      }

      const dayIt = ensureDay(it, date);
      dayIt.items.push({ ...item });
      sortItemsByTime(dayIt.items);

      const dayEn = ensureDay(en, date);
      dayEn.items.push({ ...item });
      sortItemsByTime(dayEn.items);

      existingOrig.add(lower);
      report.imported.push({ file, id, date, time, type: item.type, src: item.src, thumb: item.thumb, poster: item.poster });
    }
  }

  recalcCounts(it);
  en.counts = { ...it.counts };
  en.generated_at = it.generated_at;

  await fs.writeFile(IT_PATH, `${JSON.stringify(it, null, 2)}\n`);
  await fs.writeFile(EN_PATH, `${JSON.stringify(en, null, 2)}\n`);
  await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Imported ${report.imported.length}, skipped ${report.skipped.length}`);
  for (const row of report.imported) {
    console.log(`+ ${row.file} -> ${row.date} ${row.time || '--:--'} (${row.type}) [${row.id}]`);
  }
};

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});

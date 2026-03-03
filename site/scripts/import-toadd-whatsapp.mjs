#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'assets', 'toAdd_');
const IMG_DIR = path.join(ROOT, 'assets', 'img');
const THUMB_DIR = path.join(ROOT, 'assets', 'thumb');
const ENTRIES_IT_JSON = path.join(ROOT, 'data', 'entries.it.json');
const ENTRIES_EN_JSON = path.join(ROOT, 'data', 'entries.en.json');
const REPORT = path.join(ROOT, 'data', 'toadd_whatsapp_import_report.json');

const IMAGE_SIDE = 2048;
const THUMB_SIDE = 640;

const exists = async (p) => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};

const runSips = (input, output, maxSide) => {
  execFileSync('sips', ['-s', 'format', 'jpeg', input, '--out', output], { stdio: 'ignore' });
  execFileSync('sips', ['-s', 'formatOptions', 'best', output], { stdio: 'ignore' });
  execFileSync('sips', ['-Z', String(maxSide), output], { stdio: 'ignore' });
};

const runFfmpeg = (input, output, maxSide, quality) => {
  const vf = `scale='if(gt(iw,ih),min(${maxSide},iw),-2)':'if(gt(iw,ih),-2,min(${maxSide},ih))'`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, '-vf', vf, '-q:v', String(quality), output], { stdio: 'ignore' });
};

const normalizeCarouselIndex = (raw) => {
  const nums = String(raw || '').match(/\d+/g) || [];
  if (!nums.length) return String(raw || '').trim();
  return String(Number(nums[nums.length - 1]));
};

const parseFileName = (file) => {
  const base = path.basename(file);
  const direct = base.match(/^(\d{4}-\d{2}-\d{2})_([^_]+)_(\d+)\.(jpe?g)$/i);
  if (direct) {
    const date = direct[1];
    const rawCarousel = direct[2];
    const carousel = normalizeCarouselIndex(rawCarousel);
    const card = Number(direct[3]);
    return { date, carousel, card, isCarousel: true, rawCarousel };
  }
  const dateOnly = base.match(/^(\d{4}-\d{2}-\d{2})_/);
  if (dateOnly) {
    return { date: dateOnly[1], carousel: null, card: null, isCarousel: false, rawCarousel: null };
  }
  return null;
};

const ensureDay = (arr, date) => {
  let day = arr.find((d) => String(d.date) === String(date));
  if (!day) {
    day = { date, items: [], notes: '', recommendations: [] };
    arr.push(day);
    arr.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }
  if (!Array.isArray(day.items)) day.items = [];
  if (typeof day.notes !== 'string') day.notes = '';
  if (!Array.isArray(day.recommendations)) day.recommendations = [];
  return day;
};

const compareImported = (a, b) => {
  const aGroup = Number.isFinite(a.__carouselNum) ? a.__carouselNum : Number.POSITIVE_INFINITY;
  const bGroup = Number.isFinite(b.__carouselNum) ? b.__carouselNum : Number.POSITIVE_INFINITY;
  if (aGroup !== bGroup) return aGroup - bGroup;
  const aCard = Number.isFinite(a.__cardNum) ? a.__cardNum : Number.POSITIVE_INFINITY;
  const bCard = Number.isFinite(b.__cardNum) ? b.__cardNum : Number.POSITIVE_INFINITY;
  if (aCard !== bCard) return aCard - bCard;
  return String(a.orig || '').localeCompare(String(b.orig || ''));
};

const main = async () => {
  if (!(await exists(SRC_DIR))) {
    throw new Error('assets/toAdd_ non trovata');
  }

  const entriesIt = JSON.parse(await fs.readFile(ENTRIES_IT_JSON, 'utf8'));
  const entriesEn = JSON.parse(await fs.readFile(ENTRIES_EN_JSON, 'utf8'));
  const files = (await fs.readdir(SRC_DIR))
    .filter((f) => /\.(jpe?g)$/i.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const existingOrig = new Set();
  (entriesIt.days || []).forEach((day) => {
    (day.items || []).forEach((item) => {
      const k = String(item && item.orig ? item.orig : '').toLowerCase();
      if (k) existingOrig.add(k);
    });
  });

  await fs.mkdir(IMG_DIR, { recursive: true });
  await fs.mkdir(THUMB_DIR, { recursive: true });

  const imported = [];
  const skipped = [];

  for (const file of files) {
    const parsed = parseFileName(file);
    if (!parsed) {
      skipped.push({ file, reason: 'filename_non_supportato' });
      continue;
    }

    const origKey = file.toLowerCase();
    if (existingOrig.has(origKey)) {
      skipped.push({ file, reason: 'gia_presente_in_entries' });
      continue;
    }

    const id = createHash('sha1').update(`assets/toAdd_/${file}`).digest('hex').slice(0, 12);
    const srcPath = path.join(SRC_DIR, file);
    const outImg = path.join(IMG_DIR, `img_${id}.jpg`);
    const outThumb = path.join(THUMB_DIR, `thumb_${id}.jpg`);

    try {
      runSips(srcPath, outImg, IMAGE_SIDE);
      await fs.copyFile(outImg, outThumb);
      execFileSync('sips', ['-s', 'formatOptions', 'high', outThumb], { stdio: 'ignore' });
      execFileSync('sips', ['-Z', String(THUMB_SIDE), outThumb], { stdio: 'ignore' });
    } catch {
      runFfmpeg(srcPath, outImg, IMAGE_SIDE, 4);
      runFfmpeg(srcPath, outThumb, THUMB_SIDE, 8);
    }

    const item = {
      id,
      type: 'image',
      date: parsed.date,
      time: '',
      src: `assets/img/img_${id}.jpg`,
      thumb: `assets/thumb/thumb_${id}.jpg`,
      poster: null,
      mime: 'image/jpeg',
      size: null,
      orig: file,
      whatsappShared: true
    };

    if (parsed.isCarousel) {
      const carouselNum = Number(parsed.carousel);
      const cardNum = Number(parsed.card);
      item.carouselKey = `wa_${parsed.date}_${Number.isFinite(carouselNum) ? carouselNum : parsed.carousel}`;
      if (Number.isFinite(cardNum)) item.carouselOrder = cardNum;
      item.__carouselNum = Number.isFinite(carouselNum) ? carouselNum : Number.POSITIVE_INFINITY;
      item.__cardNum = Number.isFinite(cardNum) ? cardNum : Number.POSITIVE_INFINITY;
    }

    imported.push({ file, item, parsed });
    existingOrig.add(origKey);
  }

  const importedByDate = new Map();
  imported.forEach((entry) => {
    const date = entry.item.date;
    if (!importedByDate.has(date)) importedByDate.set(date, []);
    importedByDate.get(date).push(entry.item);
  });

  importedByDate.forEach((items, date) => {
    items.sort(compareImported);
    const day = ensureDay(entriesIt.days || [], date);
    day.items = [...(day.items || []), ...items.map((it) => {
      const clean = { ...it };
      delete clean.__carouselNum;
      delete clean.__cardNum;
      return clean;
    })];
    const dayEn = ensureDay(entriesEn.days || [], date);
    dayEn.items = [...(dayEn.items || []), ...items.map((it) => {
      const clean = { ...it };
      delete clean.__carouselNum;
      delete clean.__cardNum;
      return clean;
    })];
  });

  let images = 0;
  let videos = 0;
  let live = 0;
  (entriesIt.days || []).forEach((day) => {
    (day.items || []).forEach((item) => {
      if (item.type === 'video') videos += 1;
      else images += 1;
      if (item.live) live += 1;
    });
  });

  const counts = { images, videos, live };
  entriesIt.generated_at = new Date().toISOString();
  entriesIt.counts = counts;
  entriesEn.generated_at = entriesIt.generated_at;
  entriesEn.counts = counts;

  await fs.writeFile(ENTRIES_IT_JSON, `${JSON.stringify(entriesIt, null, 2)}\n`);
  await fs.writeFile(ENTRIES_EN_JSON, `${JSON.stringify(entriesEn, null, 2)}\n`);

  const report = {
    imported_count: imported.length,
    skipped_count: skipped.length,
    imported: imported.map((x) => ({
      file: x.file,
      id: x.item.id,
      date: x.item.date,
      carouselKey: x.item.carouselKey || null,
      carouselOrder: Number.isFinite(x.item.carouselOrder) ? x.item.carouselOrder : null,
      whatsappShared: true,
      img: x.item.src,
      thumb: x.item.thumb
    })),
    skipped
  };

  await fs.writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Import completato: ${imported.length} file (skipped ${skipped.length})`);
};

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});

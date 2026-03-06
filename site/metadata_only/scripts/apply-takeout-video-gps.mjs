#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const TAKEOUT_DIR =
  process.argv[2] ||
  '/Volumes/HardDisk/Cammino di Santiago/takeout/takeout_merged/Takeout/Google Foto/Foto da 2019';
const IT_PATH = path.join(ROOT, 'data', 'entries.it.json');
const EN_PATH = path.join(ROOT, 'data', 'entries.en.json');
const REPORT_PATH = path.join(ROOT, 'data', 'takeout_video_gps_report.json');

const SIDE_SUFFIX_PATTERNS = [
  '.supplemental-metadata.json',
  '.supplemental-metadata(1).json',
  '.supplemental-metadata(2).json',
  '.supplemental-metadata(3).json',
  '.supplemental-metadata(4).json',
  '.supplemental-metadata(5).json',
  '.supplemental-metadata(6).json',
  '.supplemental-metadata(7).json',
  '.supplemental-metadata(8).json',
  '.supplemental-metadata(9).json',
  '.supplemen.json',
  '.suppl.json',
  '.suppl(1).json',
  '.suppl(2).json',
  '.suppl(3).json'
];

const normalizeName = (name) => (name || '').trim().toLowerCase();

const validCoord = (value) => Number.isFinite(Number(value)) && Math.abs(Number(value)) > 0;

const chooseCoords = (payload) => {
  const exif = payload?.geoDataExif || {};
  const geo = payload?.geoData || {};
  if (validCoord(exif.latitude) && validCoord(exif.longitude)) {
    return { lat: Number(exif.latitude), lon: Number(exif.longitude), source: 'geoDataExif' };
  }
  if (validCoord(geo.latitude) && validCoord(geo.longitude)) {
    return { lat: Number(geo.latitude), lon: Number(geo.longitude), source: 'geoData' };
  }
  return null;
};

const sidecarMediaName = (jsonFileName) => {
  const low = jsonFileName.toLowerCase();
  for (const suffix of SIDE_SUFFIX_PATTERNS) {
    if (low.endsWith(suffix)) {
      return jsonFileName.slice(0, jsonFileName.length - suffix.length);
    }
  }
  return jsonFileName.replace(/\.json$/i, '');
};

const buildTakeoutIndex = (dir) => {
  const fileNames = fs.readdirSync(dir, { withFileTypes: true });
  const byFile = new Map();
  const byStem = new Map();
  let parsed = 0;
  let withCoords = 0;

  for (const d of fileNames) {
    if (!d.isFile()) continue;
    if (!d.name.toLowerCase().endsWith('.json')) continue;
    const abs = path.join(dir, d.name);
    let payload;
    try {
      payload = JSON.parse(fs.readFileSync(abs, 'utf8'));
      parsed += 1;
    } catch {
      continue;
    }
    const coords = chooseCoords(payload);
    if (!coords) continue;
    withCoords += 1;
    const photoTakenTs = Number(payload?.photoTakenTime?.timestamp || NaN);
    const title = normalizeName(payload?.title);
    const derived = normalizeName(sidecarMediaName(d.name));
    const entries = [title, derived].filter(Boolean);

    for (const key of entries) {
      if (!byFile.has(key)) {
        byFile.set(key, { ...coords, key, photoTakenTs, title: payload?.title || null });
      }
      const stem = key.replace(/\.[^.]+$/, '');
      if (!byStem.has(stem)) byStem.set(stem, []);
      byStem.get(stem).push({ ...coords, key, photoTakenTs, title: payload?.title || null });
    }
  }

  return { byFile, byStem, parsed, withCoords };
};

const walkItems = (items, fn) => {
  for (const item of items || []) {
    if (item?.type === 'group' && Array.isArray(item.items)) {
      walkItems(item.items, fn);
      continue;
    }
    fn(item);
  }
};

const parseLocalTs = (dateStr, timeStr) => {
  if (!dateStr || !timeStr) return NaN;
  const m = String(timeStr).match(/(\d{1,2}):(\d{2})/);
  if (!m) return NaN;
  const hh = m[1].padStart(2, '0');
  const mm = m[2];
  const iso = `${dateStr}T${hh}:${mm}:00+02:00`;
  const ts = Date.parse(iso);
  return Number.isFinite(ts) ? Math.floor(ts / 1000) : NaN;
};

const pickBestStemMatch = (candidates, item) => {
  if (!candidates?.length) return null;
  if (candidates.length === 1) return candidates[0];
  const itemTs = parseLocalTs(item?.date, item?.time);
  if (!Number.isFinite(itemTs)) return candidates[0];
  let best = candidates[0];
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const cTs = Number(c.photoTakenTs);
    const diff = Number.isFinite(cTs) ? Math.abs(cTs - itemTs) : Number.POSITIVE_INFINITY;
    if (diff < bestDiff) {
      best = c;
      bestDiff = diff;
    }
  }
  return best;
};

const applyToEntries = (entries, index, label) => {
  const stats = {
    dataset: label,
    totalVideos: 0,
    updatedExact: 0,
    updatedStemFallback: 0,
    unchanged: 0
  };
  const examples = [];

  for (const day of entries.days || []) {
    walkItems(day.items, (item) => {
      if (!item || item.type !== 'video') return;
      stats.totalVideos += 1;
      const orig = normalizeName(item.orig || item.src || '');
      if (!orig) {
        stats.unchanged += 1;
        return;
      }
      let match = index.byFile.get(orig) || null;
      let matchedBy = 'exact';
      if (!match) {
        const stem = orig.replace(/\.[^.]+$/, '');
        match = pickBestStemMatch(index.byStem.get(stem), item);
        matchedBy = 'stem';
      }
      if (!match) {
        stats.unchanged += 1;
        return;
      }

      item.lat = match.lat;
      item.lon = match.lon;
      item.gpsInferred = false;
      if ('gpsInferredFromDay' in item) delete item.gpsInferredFromDay;
      if ('gpsInferredFromPlace' in item) delete item.gpsInferredFromPlace;
      if ('gpsInferredNote' in item) delete item.gpsInferredNote;

      if (matchedBy === 'exact') stats.updatedExact += 1;
      else stats.updatedStemFallback += 1;
      if (examples.length < 40) {
        examples.push({
          id: item.id,
          orig: item.orig,
          date: item.date,
          time: item.time,
          lat: item.lat,
          lon: item.lon,
          matchedBy,
          takeoutTitle: match.title
        });
      }
    });
  }

  return { stats, examples };
};

const run = () => {
  if (!fs.existsSync(TAKEOUT_DIR)) {
    throw new Error(`Takeout directory not found: ${TAKEOUT_DIR}`);
  }
  const index = buildTakeoutIndex(TAKEOUT_DIR);
  const it = JSON.parse(fs.readFileSync(IT_PATH, 'utf8'));
  const en = JSON.parse(fs.readFileSync(EN_PATH, 'utf8'));

  const itRes = applyToEntries(it, index, 'it');
  const enRes = applyToEntries(en, index, 'en');

  fs.writeFileSync(IT_PATH, `${JSON.stringify(it, null, 2)}\n`);
  fs.writeFileSync(EN_PATH, `${JSON.stringify(en, null, 2)}\n`);

  const report = {
    takeoutDir: TAKEOUT_DIR,
    scannedSidecars: index.parsed,
    sidecarsWithGps: index.withCoords,
    it: itRes.stats,
    en: enRes.stats,
    examples: {
      it: itRes.examples,
      en: enRes.examples
    },
    generatedAt: new Date().toISOString()
  };
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
};

run();


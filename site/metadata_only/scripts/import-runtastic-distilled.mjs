#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const TRACK_POINTS_PATH = path.join(DATA_DIR, 'track_points.json');
const TRACK_GEOJSON_PATH = path.join(DATA_DIR, 'track.geojson');

const SOURCE_DIR = path.join(
  ROOT,
  'assets',
  'export-20221226-000-distilled-2019-06-03_to_2019-07-24',
  'Sport-sessions',
  'GPS-data'
);

const TZ = 'Europe/Madrid';
const MIN_SECONDS_BETWEEN_IMPORTED_POINTS = 20;

const readJson = async (p, fallback) => {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const getLocalParts = (isoUtc) => {
  const dt = new Date(isoUtc);
  if (Number.isNaN(dt.getTime())) return null;
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(dt);
  const pick = (type) => parts.find((p) => p.type === type)?.value || '';
  const y = pick('year');
  const m = pick('month');
  const d = pick('day');
  const h = pick('hour');
  const mi = pick('minute');
  const s = pick('second');
  if (!y || !m || !d || !h || !mi || !s) return null;
  const date = `${y}-${m}-${d}`;
  const time = `${h}:${mi}:${s}`;
  return { date, isoLocal: `${date}T${time}` };
};

const parseGpxPoints = (xml) => {
  const out = [];
  const re = /<trkpt[^>]*\slat="([^"]+)"[^>]*\slon="([^"]+)"[^>]*>[\s\S]*?<time>([^<]+)<\/time>/g;
  let match;
  while ((match = re.exec(xml)) !== null) {
    const lat = Number(match[1]);
    const lon = Number(match[2]);
    const isoUtc = String(match[3]).trim();
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const ts = Date.parse(isoUtc);
    if (!Number.isFinite(ts)) continue;
    const local = getLocalParts(isoUtc);
    if (!local) continue;
    out.push({
      lat,
      lon,
      time: local.isoLocal,
      date: local.date,
      _sortTs: ts,
    });
  }
  return out;
};

const downsampleByTime = (points, minSeconds) => {
  if (!points.length) return points;
  if (points.length <= 2) return points.slice();
  const minMs = Math.max(0, minSeconds * 1000);
  const sampled = [points[0]];
  let lastTs = points[0]._sortTs;
  for (let i = 1; i < points.length - 1; i += 1) {
    const p = points[i];
    if ((p._sortTs - lastTs) >= minMs) {
      sampled.push(p);
      lastTs = p._sortTs;
    }
  }
  const last = points[points.length - 1];
  if (sampled[sampled.length - 1] !== last) sampled.push(last);
  return sampled;
};

const buildGeoJson = (points) => {
  const lineCoords = points.map((p) => [p.lon, p.lat]);
  const features = [];
  if (lineCoords.length >= 2) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: lineCoords },
      properties: { points: lineCoords.length },
    });
  }
  for (const p of points) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: { time: p.time, file: p.file, date: p.date },
    });
  }
  return { type: 'FeatureCollection', features };
};

const sanitizeTrackId = (name) => name
  .replace(/\.[^.]+$/, '')
  .replace(/[^A-Za-z0-9_-]+/g, '_')
  .replace(/^_+|_+$/g, '');

const main = async () => {
  const existing = await readJson(TRACK_POINTS_PATH, []);
  const existingNonRuntastic = existing.filter(
    (p) => !String((p && p.file) || '').startsWith('RUNTASTIC_')
  );
  const dirEntries = await fs.readdir(SOURCE_DIR, { withFileTypes: true });
  const gpxFiles = dirEntries
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.gpx'))
    .map((d) => d.name)
    .sort();

  let importedRaw = 0;
  let importedSampled = 0;
  const imported = [];

  for (const fileName of gpxFiles) {
    const full = path.join(SOURCE_DIR, fileName);
    const xml = await fs.readFile(full, 'utf8');
    const parsed = parseGpxPoints(xml).sort((a, b) => a._sortTs - b._sortTs);
    if (!parsed.length) continue;
    importedRaw += parsed.length;
    const sampled = downsampleByTime(parsed, MIN_SECONDS_BETWEEN_IMPORTED_POINTS);
    importedSampled += sampled.length;
    const trackId = `RUNTASTIC_${sanitizeTrackId(fileName)}`;
    for (const p of sampled) {
      imported.push({
        lat: p.lat,
        lon: p.lon,
        time: p.time,
        file: trackId,
        date: p.date,
        _sortTs: p._sortTs,
      });
    }
  }

  const merged = [];
  const seen = new Set();

  const pushUnique = (p) => {
    const ts = Number.isFinite(p._sortTs) ? p._sortTs : Date.parse(`${p.time || ''}Z`);
    const key = `${p.lat}|${p.lon}|${p.time}|${p.file}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({
      lat: Number(p.lat),
      lon: Number(p.lon),
      time: String(p.time),
      file: String(p.file || ''),
      date: String(p.date || '').slice(0, 10),
      _sortTs: Number.isFinite(ts) ? ts : 0,
    });
  };

  for (const p of existingNonRuntastic) pushUnique(p);
  for (const p of imported) pushUnique(p);

  merged.sort((a, b) => (a._sortTs - b._sortTs) || a.file.localeCompare(b.file));

  const outPoints = merged.map(({ _sortTs, ...rest }) => rest);
  const outGeo = buildGeoJson(outPoints);

  await fs.writeFile(TRACK_POINTS_PATH, `${JSON.stringify(outPoints, null, 2)}\n`);
  await fs.writeFile(TRACK_GEOJSON_PATH, `${JSON.stringify(outGeo, null, 2)}\n`);

  console.log(`GPX files: ${gpxFiles.length}`);
  console.log(`Imported raw points: ${importedRaw}`);
  console.log(`Imported sampled points: ${importedSampled} (min ${MIN_SECONDS_BETWEEN_IMPORTED_POINTS}s)`);
  console.log(`Existing points: ${existing.length}`);
  console.log(`Existing non-runtastic points kept: ${existingNonRuntastic.length}`);
  console.log(`Merged points: ${outPoints.length}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ENTRIES_IT_JSON = path.join(ROOT, 'data', 'entries.it.json');
const ENTRIES_EN_JSON = path.join(ROOT, 'data', 'entries.en.json');
const TRACK_POINTS_JSON = path.join(ROOT, 'data', 'track_points.json');
const CACHE_JSON = path.join(ROOT, 'data', 'geocode_cache.json');

const PRECISION = Number(process.env.GEOCODE_PRECISION || 2); // 2 ~= 1.1km
const PAUSE_MS = Number(process.env.GEOCODE_PAUSE_MS || 1100);
const USER_AGENT = 'cammino-diario/1.0 (local tool)';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readJson = async (file, fallback) => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT' && typeof fallback !== 'undefined') return fallback;
    throw err;
  }
};

const normalizeName = (name) => String(name || '').trim().toUpperCase();
const stripExt = (name) => normalizeName(name).replace(/\.[A-Z0-9]+$/, '');

const roundCoord = (n, p) => {
  const m = 10 ** p;
  return Math.round(Number(n) * m) / m;
};

const keyFromCoords = (lat, lon) => `${roundCoord(lat, PRECISION)},${roundCoord(lon, PRECISION)}`;

const parseItemTime = (date, time) => {
  if (!date || !time) return Number.NaN;
  const ts = Date.parse(`${date}T${time}:00`);
  return Number.isFinite(ts) ? ts : Number.NaN;
};

const pickTrackPoint = (item, pointsByName, pointsByStem) => {
  const orig = normalizeName(item.orig || '');
  const stem = stripExt(orig);
  let candidates = pointsByName.get(orig) || [];
  if (!candidates.length && stem) candidates = pointsByStem.get(stem) || [];
  if (!candidates.length) return null;

  const targetTs = parseItemTime(item.date, item.time);
  if (!Number.isFinite(targetTs)) return candidates[0];

  let best = candidates[0];
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const p of candidates) {
    const pts = Date.parse(String(p.time || ''));
    const delta = Number.isFinite(pts) ? Math.abs(pts - targetTs) : Number.POSITIVE_INFINITY;
    if (delta < bestDelta) {
      bestDelta = delta;
      best = p;
    }
  }
  return best;
};

const formatPlace = (payload) => {
  const addr = (payload && payload.address) || {};
  const city =
    addr.city ||
    addr.town ||
    addr.village ||
    addr.hamlet ||
    addr.municipality ||
    addr.county ||
    '';
  const state = addr.state || addr.region || '';
  const country = addr.country || '';
  if (city && country) return `${city}, ${country}`;
  if (city && state) return `${city}, ${state}`;
  if (city) return city;
  if (state && country) return `${state}, ${country}`;
  if (state) return state;
  if (country) return country;
  return payload && payload.display_name ? String(payload.display_name).split(',').slice(0, 2).join(',') : '';
};

const reverseGeocode = async (lat, lon) => {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    format: 'jsonv2',
    zoom: '13',
    addressdetails: '1'
  });
  const url = `https://nominatim.openstreetmap.org/reverse?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json'
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
};

const entries = await readJson(ENTRIES_IT_JSON);
const trackPoints = await readJson(TRACK_POINTS_JSON, []);
const cache = await readJson(CACHE_JSON, {});

const pointsByName = new Map();
const pointsByStem = new Map();
for (const p of trackPoints) {
  const file = normalizeName(p.file || '');
  if (!file) continue;
  if (!pointsByName.has(file)) pointsByName.set(file, []);
  pointsByName.get(file).push(p);
  const stem = stripExt(file);
  if (!pointsByStem.has(stem)) pointsByStem.set(stem, []);
  pointsByStem.get(stem).push(p);
}

const allItems = (entries.days || []).flatMap((d) => d.items || []);
const videoOrImage = allItems.filter((it) => it && (it.type === 'image' || it.type === 'video'));

let matched = 0;
let unresolved = 0;
let cacheHit = 0;
let apiHit = 0;

for (const item of videoOrImage) {
  const point = pickTrackPoint(item, pointsByName, pointsByStem);
  if (!point || !Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lon))) {
    unresolved += 1;
    continue;
  }
  matched += 1;
  const key = keyFromCoords(point.lat, point.lon);
  let place = String(cache[key] || '').trim();
  if (place) {
    cacheHit += 1;
  } else {
    try {
      const payload = await reverseGeocode(point.lat, point.lon);
      place = formatPlace(payload);
      if (place) cache[key] = place;
      apiHit += 1;
      await sleep(PAUSE_MS);
    } catch (err) {
      // Keep item unresolved if reverse geocoding fails.
      unresolved += 1;
      continue;
    }
  }
  if (place) item.place = place;
}

const placeById = new Map(
  (entries.days || [])
    .flatMap((d) => d.items || [])
    .filter((it) => it && it.id)
    .map((it) => [String(it.id), String(it.place || '').trim()])
);

const syncPlaces = (payload) => {
  for (const day of payload.days || []) {
    for (const item of day.items || []) {
      const id = String(item && item.id ? item.id : '');
      if (!id) continue;
      const place = String(placeById.get(id) || '').trim();
      if (place) item.place = place;
    }
  }
  return payload;
};

const entriesEn = syncPlaces(await readJson(ENTRIES_EN_JSON));
await fs.writeFile(ENTRIES_IT_JSON, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
await fs.writeFile(ENTRIES_EN_JSON, `${JSON.stringify(entriesEn, null, 2)}\n`, 'utf8');
await fs.writeFile(CACHE_JSON, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');

console.log(`Matched items: ${matched}`);
console.log(`Unresolved items: ${unresolved}`);
console.log(`Cache hits: ${cacheHit}`);
console.log(`API calls: ${apiHit}`);

#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ENTRIES_IT_JSON = path.join(ROOT, 'data', 'entries.it.json');
const ENTRIES_EN_JSON = path.join(ROOT, 'data', 'entries.en.json');
const CACHE_JSON = path.join(ROOT, 'data', 'geocode_cache.json');
const REPORT_JSON = path.join(ROOT, 'data', 'video_place_refresh_report.json');

const PRECISION = Number(process.env.GEOCODE_PRECISION || 4);
const PAUSE_MS = Number(process.env.GEOCODE_PAUSE_MS || 900);
const USER_AGENT = 'cammino-diario/1.0 (refresh-video-places)';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readJson = async (file, fallback) => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT' && typeof fallback !== 'undefined') return fallback;
    throw err;
  }
};

const roundCoord = (n, p) => {
  const m = 10 ** p;
  return Math.round(Number(n) * m) / m;
};

const keyFromCoords = (lat, lon) => `${roundCoord(lat, PRECISION)},${roundCoord(lon, PRECISION)}`;

const toFiniteCoord = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (Math.abs(n) < 0.0000001) return null;
  return n;
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
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 180)}`);
  }
  return res.json();
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

const itEntries = await readJson(ENTRIES_IT_JSON);
const enEntries = await readJson(ENTRIES_EN_JSON);
const cache = await readJson(CACHE_JSON, {});

const targets = [];
for (const day of itEntries.days || []) {
  walkItems(day.items, (item) => {
    if (!item || item.type !== 'video') return;
    if (item.gpsInferred !== false) return;
    const lat = toFiniteCoord(item.lat);
    const lon = toFiniteCoord(item.lon);
    if (lat === null || lon === null) return;
    targets.push(item);
  });
}

let cacheHits = 0;
let apiCalls = 0;
let apiErrors = 0;
let updated = 0;
const samples = [];

for (const item of targets) {
  const key = keyFromCoords(item.lat, item.lon);
  let place = String(cache[key] || '').trim();
  if (place) {
    cacheHits += 1;
  } else {
    try {
      const payload = await reverseGeocode(item.lat, item.lon);
      place = formatPlace(payload);
      if (place) cache[key] = place;
      apiCalls += 1;
      await sleep(PAUSE_MS);
    } catch {
      apiErrors += 1;
      continue;
    }
  }
  if (!place) continue;
  if (String(item.place || '').trim() !== place) {
    item.place = place;
    updated += 1;
    if (samples.length < 30) {
      samples.push({
        id: item.id,
        orig: item.orig,
        date: item.date,
        time: item.time,
        lat: item.lat,
        lon: item.lon,
        place
      });
    }
  } else {
    item.place = place;
  }
}

const placeById = new Map();
for (const day of itEntries.days || []) {
  walkItems(day.items, (item) => {
    if (!item || !item.id) return;
    placeById.set(String(item.id), String(item.place || '').trim());
  });
}

for (const day of enEntries.days || []) {
  walkItems(day.items, (item) => {
    if (!item || !item.id) return;
    const p = placeById.get(String(item.id));
    if (p) item.place = p;
  });
}

await fs.writeFile(ENTRIES_IT_JSON, `${JSON.stringify(itEntries, null, 2)}\n`, 'utf8');
await fs.writeFile(ENTRIES_EN_JSON, `${JSON.stringify(enEntries, null, 2)}\n`, 'utf8');
await fs.writeFile(CACHE_JSON, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');

const report = {
  precision: PRECISION,
  pauseMs: PAUSE_MS,
  targetVideos: targets.length,
  updatedPlaces: updated,
  cacheHits,
  apiCalls,
  apiErrors,
  sampleUpdates: samples,
  generatedAt: new Date().toISOString()
};
await fs.writeFile(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(JSON.stringify(report, null, 2));


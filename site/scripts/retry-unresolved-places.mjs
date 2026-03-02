#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ENTRIES_JSON = path.join(ROOT, 'data', 'entries.json');
const ENTRIES_JS = path.join(ROOT, 'data', 'entries.js');
const TRACK_POINTS_JSON = path.join(ROOT, 'data', 'track_points.json');
const CACHE_JSON = path.join(ROOT, 'data', 'geocode_cache.json');

const PRECISION = Number(process.env.GEOCODE_PRECISION || 2);
const PAUSE_MS = Number(process.env.GEOCODE_PAUSE_MS || 1100);
const USER_AGENT = 'cammino-diario/1.0 (retry-unresolved)';

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

const parsePointTime = (value) => {
  const ts = Date.parse(String(value || ''));
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

const pickNearestPointByDayTime = (item, pointsByDay) => {
  const dayPoints = pointsByDay.get(String(item.date || '')) || [];
  if (!dayPoints.length) return null;
  const targetTs = parseItemTime(item.date, item.time);
  if (!Number.isFinite(targetTs)) return dayPoints[0];
  let best = dayPoints[0];
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const p of dayPoints) {
    const pts = parsePointTime(p.time);
    if (!Number.isFinite(pts)) continue;
    const delta = Math.abs(pts - targetTs);
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
  const country = addr.country || '';
  const state = addr.state || addr.region || '';
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
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
  }
  return res.json();
};

const formatPlaceBigDataCloud = (payload) => {
  const city = String(payload && (payload.city || payload.locality) || '').trim();
  const subdivision = String(payload && payload.principalSubdivision || '').trim();
  const country = String(payload && payload.countryName || '').trim();
  if (city && country) return `${city}, ${country}`;
  if (city && subdivision) return `${city}, ${subdivision}`;
  if (city) return city;
  if (subdivision && country) return `${subdivision}, ${country}`;
  if (subdivision) return subdivision;
  if (country) return country;
  return '';
};

const reverseGeocodeBigDataCloud = async (lat, lon) => {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    localityLanguage: 'it'
  });
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json'
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
  }
  return res.json();
};

const entries = await readJson(ENTRIES_JSON);
const trackPoints = await readJson(TRACK_POINTS_JSON, []);
const cache = await readJson(CACHE_JSON, {});

const pointsByName = new Map();
const pointsByStem = new Map();
const pointsByDay = new Map();
for (const p of trackPoints) {
  const file = normalizeName(p.file || '');
  if (!file) continue;
  if (!pointsByName.has(file)) pointsByName.set(file, []);
  pointsByName.get(file).push(p);
  const stem = stripExt(file);
  if (!pointsByStem.has(stem)) pointsByStem.set(stem, []);
  pointsByStem.get(stem).push(p);
  const day = String(p.date || '');
  if (day) {
    if (!pointsByDay.has(day)) pointsByDay.set(day, []);
    pointsByDay.get(day).push(p);
  }
}

const unresolvedItems = (entries.days || [])
  .flatMap((d) => d.items || [])
  .filter((it) => (it.type === 'image' || it.type === 'video') && !String(it.place || '').trim());

let total = unresolvedItems.length;
let noGps = 0;
let cacheHit = 0;
let apiHit = 0;
let resolved = 0;
let apiFail = 0;
let nearestDayFallback = 0;
let providerFallbackHit = 0;

for (const item of unresolvedItems) {
  let point = pickTrackPoint(item, pointsByName, pointsByStem);
  if ((!point || !Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lon)))) {
    point = pickNearestPointByDayTime(item, pointsByDay);
    if (point) nearestDayFallback += 1;
  }
  if (!point || !Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lon))) {
    noGps += 1;
    continue;
  }
  const key = keyFromCoords(point.lat, point.lon);
  let place = String(cache[key] || '').trim();
  if (place) {
    cacheHit += 1;
  } else {
    try {
      const payload = await reverseGeocode(point.lat, point.lon);
      place = formatPlace(payload);
      if (!place) {
        const payloadAlt = await reverseGeocodeBigDataCloud(point.lat, point.lon);
        place = formatPlaceBigDataCloud(payloadAlt);
        if (place) providerFallbackHit += 1;
      }
      if (place) cache[key] = place;
      apiHit += 1;
      await sleep(PAUSE_MS);
    } catch {
      apiFail += 1;
      continue;
    }
  }
  if (place) {
    item.place = place;
    resolved += 1;
  }
}

await fs.writeFile(ENTRIES_JSON, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
await fs.writeFile(ENTRIES_JS, `window.__CAMMINO_ENTRIES__ = ${JSON.stringify(entries, null, 2)};\n`, 'utf8');
await fs.writeFile(CACHE_JSON, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');

console.log(`Unresolved before retry: ${total}`);
console.log(`Resolved now: ${resolved}`);
console.log(`No GPS match: ${noGps}`);
console.log(`Cache hits: ${cacheHit}`);
console.log(`API calls: ${apiHit}`);
console.log(`API failures: ${apiFail}`);
console.log(`Nearest-day fallback used: ${nearestDayFallback}`);
console.log(`Alternate provider hits: ${providerFallbackHit}`);

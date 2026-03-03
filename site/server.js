const http = require('http');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { createReadStream } = require('fs');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname);
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const SUPPORTED_LANGS = new Set(['it', 'en']);
const ENTRY_LANGS = ['it', 'en'];
const ENTRIES_PATH_BY_LANG = {
  it: path.join(ROOT, 'data', 'entries.it.json'),
  en: path.join(ROOT, 'data', 'entries.en.json')
};
const SEO_BY_LANG = {
  it: {
    title: 'Cammino di Santiago — Diario Visivo',
    description: 'Diario visivo del Cammino di Santiago con foto, video, tracce GPS e racconti giornalieri.'
  },
  en: {
    title: 'Camino de Santiago — Visual Diary',
    description: 'Visual Camino de Santiago diary with photos, videos, GPS tracks, and day-by-day storytelling.'
  }
};

function loadDotEnv(rootDir) {
  try {
    const envPath = path.join(rootDir, '.env');
    if (!fsSync.existsSync(envPath)) return;
    const raw = fsSync.readFileSync(envPath, 'utf8');
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = String(line || '').trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const idx = trimmed.indexOf('=');
      if (idx <= 0) return;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (!key) return;
      if (typeof process.env[key] === 'undefined') {
        process.env[key] = value;
      }
    });
  } catch {
    // Ignore .env parsing errors and keep defaults.
  }
}

loadDotEnv(ROOT);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

let deleteInFlight = false;
const COMMENTS_PATH = path.join(ROOT, 'data', 'comments.json');
const COMMENTS_MAX_TEXT = 1200;
const COMMENTS_MAX_AUTHOR = 80;
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || process.env.COMMENTS_ADMIN_TOKEN || 'CHANGE_ME');
const ADMIN_SESSION_COOKIE = 'cammino_admin_session';
const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const ADMIN_COOKIE_SECURE = String(process.env.ADMIN_COOKIE_SECURE || '0') === '1';
const adminSessions = new Map();

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders
  });
  res.end(body);
}

function toFsPath(urlPath) {
  const sanitized = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const wanted = sanitized === '/' ? '/index.html' : sanitized;
  const resolved = path.resolve(ROOT, `.${wanted}`);
  if (!resolved.startsWith(ROOT + path.sep) && resolved !== ROOT) {
    return null;
  }
  return resolved;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getRequestOrigin(req) {
  const protoHeader = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const hostHeader = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const proto = protoHeader || (ADMIN_COOKIE_SECURE ? 'https' : 'http');
  const host = hostHeader || `${HOST}:${PORT}`;
  return `${proto}://${host}`;
}

function parseLocaleFromPath(pathname) {
  const pathValue = String(pathname || '/');
  const match = pathValue.match(/^\/(it|en)(\/|$)/i);
  if (!match) {
    return {
      locale: '',
      strippedPath: pathValue || '/',
      needsTrailingSlashRedirect: false
    };
  }
  const locale = String(match[1] || '').toLowerCase();
  const needsTrailingSlashRedirect = pathValue === `/${locale}`;
  let strippedPath = pathValue.slice(locale.length + 1);
  if (!strippedPath) strippedPath = '/';
  if (!strippedPath.startsWith('/')) strippedPath = `/${strippedPath}`;
  return {
    locale: SUPPORTED_LANGS.has(locale) ? locale : '',
    strippedPath,
    needsTrailingSlashRedirect
  };
}

function localizeIndexHtml(rawHtml, locale, req) {
  const lang = SUPPORTED_LANGS.has(String(locale || '').toLowerCase())
    ? String(locale).toLowerCase()
    : 'it';
  const seo = SEO_BY_LANG[lang] || SEO_BY_LANG.it;
  const origin = getRequestOrigin(req);
  const canonical = `${origin}/${lang}/`;
  const altIt = `${origin}/it/`;
  const altEn = `${origin}/en/`;

  let out = String(rawHtml || '');
  out = out.replace(/<html lang="[^"]*">/i, `<html lang="${lang}">`);
  out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(seo.title)}</title>`);
  out = out.replace(
    /(<meta[^>]*id="meta-description"[^>]*content=")[^"]*(")/i,
    `$1${escapeHtml(seo.description)}$2`
  );
  out = out.replace(/(<link[^>]*id="seo-canonical"[^>]*href=")[^"]*(")/i, `$1${escapeHtml(canonical)}$2`);
  out = out.replace(/(<link[^>]*id="seo-alt-it"[^>]*href=")[^"]*(")/i, `$1${escapeHtml(altIt)}$2`);
  out = out.replace(/(<link[^>]*id="seo-alt-en"[^>]*href=")[^"]*(")/i, `$1${escapeHtml(altEn)}$2`);
  out = out.replace(
    /(<link[^>]*id="seo-alt-default"[^>]*href=")[^"]*(")/i,
    `$1${escapeHtml(altIt)}$2`
  );
  return out;
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err && err.code === 'ENOENT' && typeof fallback !== 'undefined') return fallback;
    throw err;
  }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function safeUnlink(filePath) {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    throw err;
  }
}

async function parseJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let rawBody = '';
    req.on('data', (chunk) => {
      rawBody += chunk;
      if (rawBody.length > maxBytes) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('error', reject);
    req.on('end', () => {
      try {
        resolve(rawBody ? JSON.parse(rawBody) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

function normalizeCommentTarget(value) {
  const target = String(value || '').trim();
  if (!target) return '';
  if (!/^[a-z0-9][a-z0-9._:-]{2,120}$/i.test(target)) return '';
  return target;
}

function normalizeCommentAuthor(value) {
  const author = String(value || '').trim().replace(/\s+/g, ' ');
  if (!author) return '';
  return author.slice(0, COMMENTS_MAX_AUTHOR);
}

function normalizeCommentText(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.slice(0, COMMENTS_MAX_TEXT);
}

async function readCommentsStore() {
  const base = { version: 1, comments: [] };
  const parsed = await readJson(COMMENTS_PATH, base);
  if (!parsed || typeof parsed !== 'object') return base;
  if (!Array.isArray(parsed.comments)) parsed.comments = [];
  return parsed;
}

async function writeCommentsStore(store) {
  const payload = {
    version: 1,
    comments: Array.isArray(store && store.comments) ? store.comments : []
  };
  await writeJson(COMMENTS_PATH, payload);
}

function toPublicComment(comment) {
  return {
    id: String(comment.id || ''),
    target: String(comment.target || ''),
    author: String(comment.author || ''),
    text: String(comment.text || ''),
    created_at: String(comment.created_at || '')
  };
}

function parseCookies(req) {
  const header = String(req.headers.cookie || '');
  if (!header) return {};
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx <= 0) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) return;
    out[key] = decodeURIComponent(value);
  });
  return out;
}

function getAdminTokenFromRequest(req, urlObj) {
  const headerToken = String(req.headers['x-admin-token'] || '').trim();
  const queryToken = String((urlObj && urlObj.searchParams.get('token')) || '').trim();
  return headerToken || queryToken;
}

function cleanupExpiredAdminSessions() {
  const now = Date.now();
  for (const [sid, exp] of adminSessions.entries()) {
    if (!Number.isFinite(exp) || exp <= now) adminSessions.delete(sid);
  }
}

function hasValidAdminSession(req) {
  cleanupExpiredAdminSessions();
  const cookies = parseCookies(req);
  const sid = String(cookies[ADMIN_SESSION_COOKIE] || '').trim();
  if (!sid) return false;
  const exp = adminSessions.get(sid);
  if (!Number.isFinite(exp) || exp <= Date.now()) {
    adminSessions.delete(sid);
    return false;
  }
  adminSessions.set(sid, Date.now() + ADMIN_SESSION_TTL_MS);
  return true;
}

function isValidAdminToken(token) {
  const t = String(token || '').trim();
  if (!t) return false;
  return t === ADMIN_TOKEN;
}

function buildAdminCookie(sessionId, maxAgeSeconds) {
  const parts = [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.round(maxAgeSeconds))}`
  ];
  if (ADMIN_COOKIE_SECURE) parts.push('Secure');
  return parts.join('; ');
}

function issueAdminSession(res) {
  cleanupExpiredAdminSessions();
  const sid = crypto.randomBytes(24).toString('hex');
  adminSessions.set(sid, Date.now() + ADMIN_SESSION_TTL_MS);
  return buildAdminCookie(sid, Math.round(ADMIN_SESSION_TTL_MS / 1000));
}

function clearAdminSession(res) {
  return buildAdminCookie('', 0);
}

function ensureAdmin(req, res, urlObj) {
  if (hasValidAdminSession(req)) return true;
  const token = getAdminTokenFromRequest(req, urlObj);
  if (!isValidAdminToken(token)) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return false;
  }
  return true;
}

async function handleAdminSessionStatus(req, res) {
  sendJson(res, 200, { authenticated: hasValidAdminSession(req) });
}

async function handleAdminSessionLogin(req, res) {
  try {
    const payload = await parseJsonBody(req, 64 * 1024);
    const token = String(payload && payload.token ? payload.token : '').trim();
    if (!isValidAdminToken(token)) {
      sendJson(res, 401, { error: 'Invalid admin token' });
      return;
    }
    const cookie = issueAdminSession(res);
    sendJson(
      res,
      200,
      { ok: true, authenticated: true, ttl_ms: ADMIN_SESSION_TTL_MS },
      { 'Set-Cookie': cookie }
    );
  } catch (err) {
    sendJson(res, 500, { error: err.message || String(err) });
  }
}

async function handleAdminSessionLogout(req, res) {
  const cookies = parseCookies(req);
  const sid = String(cookies[ADMIN_SESSION_COOKIE] || '').trim();
  if (sid) adminSessions.delete(sid);
  sendJson(
    res,
    200,
    { ok: true, authenticated: false },
    { 'Set-Cookie': clearAdminSession(res) }
  );
}

async function handleGetComments(req, res) {
  try {
    const urlObj = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    const target = normalizeCommentTarget(urlObj.searchParams.get('target'));
    if (!target) {
      sendJson(res, 400, { error: 'Missing or invalid target' });
      return;
    }
    const store = await readCommentsStore();
    const items = store.comments
      .filter((c) => String(c.target || '') === target)
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
      .map(toPublicComment);
    sendJson(res, 200, { target, comments: items });
  } catch (err) {
    sendJson(res, 500, { error: err.message || String(err) });
  }
}

async function handleGetCommentCounts(req, res) {
  try {
    const urlObj = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    const rawTargets = String(urlObj.searchParams.get('targets') || '');
    const targets = rawTargets
      .split(',')
      .map((v) => normalizeCommentTarget(v))
      .filter(Boolean);
    if (!targets.length) {
      sendJson(res, 400, { error: 'Missing targets' });
      return;
    }
    const wanted = new Set(targets);
    const counts = {};
    targets.forEach((t) => {
      counts[t] = 0;
    });
    const store = await readCommentsStore();
    for (const comment of store.comments) {
      const target = String(comment.target || '');
      if (!wanted.has(target)) continue;
      counts[target] = (counts[target] || 0) + 1;
    }
    sendJson(res, 200, { counts });
  } catch (err) {
    sendJson(res, 500, { error: err.message || String(err) });
  }
}

async function handleCreateComment(req, res) {
  try {
    const payload = await parseJsonBody(req, 256 * 1024);
    const target = normalizeCommentTarget(payload && payload.target);
    const author = normalizeCommentAuthor(payload && payload.author);
    const text = normalizeCommentText(payload && payload.text);
    if (!target) {
      sendJson(res, 400, { error: 'Missing or invalid target' });
      return;
    }
    if (!author) {
      sendJson(res, 400, { error: 'Missing author' });
      return;
    }
    if (!text) {
      sendJson(res, 400, { error: 'Missing text' });
      return;
    }
    const store = await readCommentsStore();
    const now = new Date().toISOString();
    const comment = {
      id: `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      target,
      author,
      text,
      created_at: now
    };
    store.comments.push(comment);
    await writeCommentsStore(store);
    sendJson(res, 201, { ok: true, comment: toPublicComment(comment) });
  } catch (err) {
    sendJson(res, 500, { error: err.message || String(err) });
  }
}

async function handleAdminListComments(req, res) {
  try {
    const urlObj = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    if (!ensureAdmin(req, res, urlObj)) return;
    const target = normalizeCommentTarget(urlObj.searchParams.get('target'));
    const q = String(urlObj.searchParams.get('q') || '').trim().toLowerCase();
    const limitRaw = Number(urlObj.searchParams.get('limit') || 500);
    const limit = Number.isFinite(limitRaw) ? Math.min(5000, Math.max(1, Math.round(limitRaw))) : 500;

    const store = await readCommentsStore();
    let comments = store.comments
      .map((c) => toPublicComment(c))
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

    if (target) {
      comments = comments.filter((c) => c.target === target);
    }
    if (q) {
      comments = comments.filter((c) =>
        String(c.target || '').toLowerCase().includes(q)
        || String(c.author || '').toLowerCase().includes(q)
        || String(c.text || '').toLowerCase().includes(q)
      );
    }
    const sliced = comments.slice(0, limit);
    const countsByTarget = {};
    comments.forEach((c) => {
      countsByTarget[c.target] = (countsByTarget[c.target] || 0) + 1;
    });
    sendJson(res, 200, {
      comments: sliced,
      total: comments.length,
      counts_by_target: countsByTarget
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message || String(err) });
  }
}

async function handleAdminDeleteComment(req, res) {
  try {
    const urlObj = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    if (!ensureAdmin(req, res, urlObj)) return;
    const payload = await parseJsonBody(req, 128 * 1024);
    const id = String(payload && payload.id ? payload.id : '').trim();
    if (!id) {
      sendJson(res, 400, { error: 'Missing id' });
      return;
    }
    const store = await readCommentsStore();
    const before = store.comments.length;
    store.comments = store.comments.filter((c) => String(c.id || '') !== id);
    const removed = before - store.comments.length;
    if (!removed) {
      sendJson(res, 404, { error: 'Comment not found' });
      return;
    }
    await writeCommentsStore(store);
    sendJson(res, 200, { ok: true, removed: 1 });
  } catch (err) {
    sendJson(res, 500, { error: err.message || String(err) });
  }
}

function isInsideRoot(filePath) {
  return filePath.startsWith(ROOT + path.sep) || filePath === ROOT;
}

function normalizeDays(days) {
  return days
    .map((day) => ({ ...day, items: Array.isArray(day.items) ? day.items : [] }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function rebuildCounts(days) {
  const counts = { images: 0, videos: 0, live: 0 };
  for (const day of days) {
    for (const item of day.items || []) {
      if (item.type === 'video') counts.videos += 1;
      else counts.images += 1;
      if (item.live) counts.live += 1;
    }
  }
  return counts;
}

async function readEntriesByLang(lang) {
  const pathForLang = ENTRIES_PATH_BY_LANG[lang];
  return readJson(pathForLang);
}

async function writeEntriesByLang(lang, entries) {
  const pathForLang = ENTRIES_PATH_BY_LANG[lang];
  await writeJson(pathForLang, entries);
}

function removeTrackFileRefs(trackPoints, removedOrigSet) {
  return trackPoints.filter((p) => !removedOrigSet.has(String(p.file || '')));
}

function rebuildTrackByDay(trackPoints) {
  const byDay = {};
  for (const point of trackPoints) {
    const key = String(point.date || '').slice(0, 10);
    if (!key) continue;
    if (!byDay[key]) byDay[key] = [];
    byDay[key].push(point);
  }
  return byDay;
}

function rebuildTrackGeoJson(trackPoints) {
  const coords = trackPoints
    .map((p) => [Number(p.lon), Number(p.lat)])
    .filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: coords
        },
        properties: {
          points: coords.length
        }
      }
    ]
  };
}

async function handleDelete(req, res) {
  const urlObj = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  if (!ensureAdmin(req, res, urlObj)) return;
  if (deleteInFlight) {
    sendJson(res, 409, { error: 'Delete already in progress' });
    return;
  }

  try {
    deleteInFlight = true;
    const payload = await parseJsonBody(req);
    const ids = Array.isArray(payload.ids) ? payload.ids.map((v) => String(v)) : [];
    if (!ids.length) {
      sendJson(res, 400, { error: 'No ids provided' });
      return;
    }

    const trackPointsPath = path.join(ROOT, 'data', 'track_points.json');
    const trackByDayPath = path.join(ROOT, 'data', 'track_by_day.json');
    const trackGeoJsonPath = path.join(ROOT, 'data', 'track.geojson');
    const idSet = new Set(ids);

    const entriesByLang = {};
    for (const lang of ENTRY_LANGS) {
      entriesByLang[lang] = await readEntriesByLang(lang);
    }

    const primaryEntries = entriesByLang.it || entriesByLang.en;
    const primaryDays = Array.isArray(primaryEntries.days) ? primaryEntries.days : [];
    const removedItems = [];
    const nextPrimaryDays = primaryDays.map((day) => {
      const keepItems = [];
      for (const item of day.items || []) {
        if (item.id && idSet.has(String(item.id))) removedItems.push(item);
        else keepItems.push(item);
      }
      return { ...day, items: keepItems };
    });

    if (!removedItems.length) {
      sendJson(res, 200, {
        removed: 0,
        files_deleted: 0,
        data: entriesByLang.it || entriesByLang.en
      });
      return;
    }

    const removedOrigSet = new Set(
      removedItems
        .map((item) => String(item.orig || '').trim())
        .filter(Boolean)
    );

    const filesToDelete = new Set();
    for (const item of removedItems) {
      for (const key of ['src', 'thumb', 'poster']) {
        const file = item[key];
        if (typeof file === 'string' && file.trim()) {
          filesToDelete.add(path.resolve(ROOT, file));
        }
      }
      const orig = String(item.orig || '').trim();
      if (orig) filesToDelete.add(path.join(ROOT, 'new', orig));
    }

    let filesDeleted = 0;
    for (const filePath of filesToDelete) {
      const withinRoot = filePath.startsWith(ROOT + path.sep) || filePath === ROOT;
      if (!withinRoot) continue;
      const ok = await safeUnlink(filePath);
      if (ok) filesDeleted += 1;
    }

    const updatedEntriesByLang = {};
    for (const lang of ENTRY_LANGS) {
      const entries = entriesByLang[lang];
      const days = Array.isArray(entries.days) ? entries.days : [];
      const nextDays = lang === 'it'
        ? nextPrimaryDays
        : days.map((day) => {
          const keepItems = (day.items || []).filter((item) => !(item.id && idSet.has(String(item.id))));
          return { ...day, items: keepItems };
        });
      const normalizedDays = normalizeDays(nextDays);
      updatedEntriesByLang[lang] = {
        ...entries,
        generated_at: new Date().toISOString(),
        days: normalizedDays,
        counts: rebuildCounts(normalizedDays)
      };
    }

    const trackPoints = await readJson(trackPointsPath, []);
    const filteredTrackPoints = removeTrackFileRefs(trackPoints, removedOrigSet);
    const rebuiltTrackByDay = rebuildTrackByDay(filteredTrackPoints);
    const rebuiltTrackGeo = rebuildTrackGeoJson(filteredTrackPoints);

    for (const lang of ENTRY_LANGS) {
      await writeEntriesByLang(lang, updatedEntriesByLang[lang]);
    }
    await writeJson(trackPointsPath, filteredTrackPoints);
    await writeJson(trackByDayPath, rebuiltTrackByDay);
    await writeJson(trackGeoJsonPath, rebuiltTrackGeo);

    sendJson(res, 200, {
      removed: removedItems.length,
      files_deleted: filesDeleted,
      data: updatedEntriesByLang.it || updatedEntriesByLang.en
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message || String(err) });
  } finally {
    deleteInFlight = false;
  }
}

async function serveStatic(req, res, requestPath = null, locale = '') {
  const fsPath = toFsPath(requestPath || req.url || '/');
  if (!fsPath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  let stat;
  try {
    stat = await fs.stat(fsPath);
  } catch {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const finalPath = stat.isDirectory() ? path.join(fsPath, 'index.html') : fsPath;
  const ext = path.extname(finalPath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const noCacheExt = new Set(['.html', '.json', '.js']);

  if (ext === '.html' && finalPath === path.join(ROOT, 'index.html') && locale) {
    try {
      const raw = await fs.readFile(finalPath, 'utf8');
      const html = localizeIndexHtml(raw, locale, req);
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': 'no-cache'
      });
      if (req.method === 'HEAD') {
        res.end();
      } else {
        res.end(html);
      }
      return;
    } catch {
      // Fallback to standard static stream.
    }
  }

  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': noCacheExt.has(ext) ? 'no-cache' : 'public, max-age=3600'
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(finalPath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token'
    });
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url.split('?')[0] === '/api/delete') {
    await handleDelete(req, res);
    return;
  }
  if (req.method === 'GET' && req.url.split('?')[0] === '/api/admin/session') {
    await handleAdminSessionStatus(req, res);
    return;
  }
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/admin/session') {
    await handleAdminSessionLogin(req, res);
    return;
  }
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/admin/logout') {
    await handleAdminSessionLogout(req, res);
    return;
  }
  if (req.method === 'GET' && req.url.split('?')[0] === '/api/comments') {
    await handleGetComments(req, res);
    return;
  }
  if (req.method === 'GET' && req.url.split('?')[0] === '/api/comments/counts') {
    await handleGetCommentCounts(req, res);
    return;
  }
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/comments') {
    await handleCreateComment(req, res);
    return;
  }
  if (req.method === 'GET' && req.url.split('?')[0] === '/api/admin/comments') {
    await handleAdminListComments(req, res);
    return;
  }
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/admin/comments/delete') {
    await handleAdminDeleteComment(req, res);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end('Method not allowed');
    return;
  }

  const urlObj = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  if (urlObj.pathname === '/') {
    const target = `/it/${urlObj.search || ''}`;
    res.writeHead(302, { Location: target });
    res.end();
    return;
  }

  const localeInfo = parseLocaleFromPath(urlObj.pathname);
  if (localeInfo.locale && localeInfo.needsTrailingSlashRedirect) {
    res.writeHead(301, { Location: `/${localeInfo.locale}/${urlObj.search || ''}` });
    res.end();
    return;
  }

  const staticPath = localeInfo.locale
    ? `${localeInfo.strippedPath}${urlObj.search || ''}`
    : req.url;
  await serveStatic(req, res, staticPath, localeInfo.locale);
});

server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});

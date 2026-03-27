const http = require('http');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { createReadStream } = require('fs');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname);
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const PRIMARY_SITE_HOST = String(process.env.SITE_PRIMARY_HOST || 'mycamino.it').trim().toLowerCase();
const LEGACY_SITE_HOSTS = new Set(
  String(process.env.LEGACY_SITE_HOSTS || 'mycamino.semproxlab.it')
    .split(',')
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
);
const SUPPORTED_LANGS = new Set(['it', 'en', 'es', 'fr']);
const ENTRY_LANGS = ['it', 'en'];
const ENTRIES_PATH_BY_LANG = {
  it: path.join(ROOT, 'data', 'entries.it.json'),
  en: path.join(ROOT, 'data', 'entries.en.json'),
  es: path.join(ROOT, 'data', 'entries.es.json'),
  fr: path.join(ROOT, 'data', 'entries.fr.json')
};
const SEO_BY_LANG = {
  it: {
    title: 'Cammino di Santiago — Diario Visivo',
    description: 'Diario visivo del Cammino di Santiago con foto, video, tracce GPS e racconti giornalieri.'
  },
  en: {
    title: 'Camino de Santiago — Visual Diary',
    description: 'Visual Camino de Santiago diary with photos, videos, GPS tracks, and day-by-day storytelling.'
  },
  es: {
    title: 'Camino de Santiago — Diario Visual',
    description: 'Diario visual del Camino de Santiago con fotos, vídeos, trazas GPS y relatos diarios.'
  },
  fr: {
    title: 'Chemin de Saint-Jacques — Journal Visuel',
    description: 'Journal visuel du Chemin de Saint-Jacques avec photos, vidéos, traces GPS et récits quotidiens.'
  }
};
const SITE_AUTHOR = 'Jacopo';
const OG_IMAGE_WIDTH = 1200;
const OG_IMAGE_HEIGHT = 630;
const OG_IMAGE_TYPE = 'image/jpeg';
const PROLOGUE_DATES = ['2019-06-02', '2019-06-03'];
const PROLOGUE_TRACK_DATE = '2019-06-03';
const DAY_PAGE_PATH_RE = /^\/(it|en|es|fr)\/day\/(\d{4}-\d{2}-\d{2})\/?$/i;
const PROLOGUE_PAGE_PATH_RE = /^\/(it|en|es|fr)\/prologue\/?$/i;
const MAP_PAGE_PATH_RE = /^\/(it|en|es|fr)\/map\/?$/i;
const PEOPLE_PAGE_PATH_RE = /^\/(it|en|es|fr)\/people\/?$/i;
const CONTACT_PAGE_PATH_RE = /^\/(it|en|es|fr)\/contatti\/?$/i;
const OFFER_PAGE_PATH_RE = /^\/(it|en|es|fr)\/crea-il-tuo-diario\/?$/i;
const FREE_GUIDE_SLUG_BY_LANG = {
  it: 'guida-gratuita',
  en: 'free-guide',
  es: 'guia-gratuita',
  fr: 'guide-gratuite'
};
const FREE_GUIDE_PATH_BY_LANG = Object.fromEntries(
  Object.entries(FREE_GUIDE_SLUG_BY_LANG).map(([lang, slug]) => [lang, `/${lang}/${slug}/`])
);
const PRIVACY_PAGE_PATH_RE = /^\/privacy-policy\/?$/i;
const COOKIE_POLICY_PATH_RE = /^\/cookie-policy\/?$/i;
const TERMS_PAGE_PATH_RE = /^\/termini-e-condizioni\/?$/i;

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
const DAY_OG_OVERRIDES_PATH = path.join(ROOT, 'data', 'day_og_overrides.json');
const UI_FLAGS_PATH = path.join(ROOT, 'data', 'ui_flags.json');
const ADMIN_AUTH_PATH = path.join(ROOT, 'data', 'admin_auth.json');
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

function buildStaticFallbackCandidates(urlPath) {
  const sanitized = decodeURIComponent(String(urlPath || '').split('?')[0].split('#')[0]);
  const out = [];
  const datedMatch = sanitized.match(/^\/assets\/(img|thumb|poster|video_resized)\/(\d{4}-\d{2}-\d{2})\/([^/]+)$/i);
  if (datedMatch) {
    const kind = String(datedMatch[1] || '').toLowerCase();
    const file = String(datedMatch[3] || '');
    out.push(`/assets/${kind}/${file}`);
    out.push(`/deploy-runtime/assets/${kind}/${file}`);
    return out;
  }
  const flatMatch = sanitized.match(/^\/assets\/(img|thumb|poster|video_resized)\/([^/]+)$/i);
  if (flatMatch) {
    const kind = String(flatMatch[1] || '').toLowerCase();
    const file = String(flatMatch[2] || '');
    out.push(`/deploy-runtime/assets/${kind}/${file}`);
    return out;
  }
  return out;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function defaultUiFlags() {
  return {
    show_footer_template_cta: true
  };
}

function buildAbsoluteUrl(origin, pathValue) {
  const base = String(origin || '').replace(/\/+$/, '');
  const pathPart = String(pathValue || '/').startsWith('/') ? String(pathValue || '/') : `/${String(pathValue || '/')}`;
  return `${base}${pathPart}`;
}

function normalizePathname(pathname = '/') {
  const value = String(pathname || '/').replace(/\/+$/, '');
  return value || '/';
}

function matchLocalizedStaticPath(pathname, localizedPathByLang) {
  const normalizedPath = normalizePathname(pathname);
  for (const [lang, targetPath] of Object.entries(localizedPathByLang || {})) {
    if (normalizedPath === normalizePathname(targetPath)) return String(lang || '').toLowerCase();
  }
  return '';
}

function markdownToSafeHtml(markdown) {
  const raw = String(markdown || '').trim();
  if (!raw) return '';
  let html = escapeHtml(raw);
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  const blocks = html.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  return blocks.map((part) => `<p>${part.replace(/\n/g, '<br/>')}</p>`).join('\n');
}

function firstTextParagraph(markdown, maxLen = 220) {
  const text = String(markdown || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1).trim()}…`;
}

function truncateText(text, maxLen = 160) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen - 1).trim()}…`;
}

function parseNoteSections(markdown) {
  const lines = String(markdown || '').replace(/\r/g, '').split('\n');
  const sections = [];
  let current = null;
  const pushCurrent = () => {
    if (!current) return;
    const body = current.lines.join(' ').replace(/\s+/g, ' ').trim();
    sections.push({ heading: current.heading, body });
  };
  lines.forEach((line) => {
    const headingMatch = String(line || '').trim().match(/^\*\*([^*]+)\*\*$/);
    if (headingMatch) {
      pushCurrent();
      current = { heading: String(headingMatch[1] || '').trim(), lines: [] };
      return;
    }
    if (!current) return;
    const clean = String(line || '').trim();
    if (clean) current.lines.push(clean);
  });
  pushCurrent();
  return sections;
}

function firstSentence(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  const match = value.match(/^(.+?[.!?])(?:\s|$)/);
  return match ? String(match[1] || '').trim() : value;
}

function buildDaySeoTitle(day, lang, ui, options = {}) {
  const date = String(day && day.date ? day.date : '');
  const sections = parseNoteSections(day && day.notes ? day.notes : '');
  const title = String((sections[0] && sections[0].body) || '').trim();
  const stageLabel = String(options.stageLabel || '').trim()
    || `${String(ui.dayLabelPrefix || 'Day').trim()} ${String(options.dayNumber || '').trim()}`.trim();
  if (title) return `${title} | ${stageLabel} | ${ui.titlePrefix}`;
  return `${stageLabel} | ${ui.titlePrefix}`;
}

function buildDaySeoDescription(day, lang, ui) {
  const sections = parseNoteSections(day && day.notes ? day.notes : '');
  const title = String((sections[0] && sections[0].body) || '').trim();
  const stage = String((sections[1] && sections[1].body) || '').trim();
  const scene = firstSentence((sections[2] && sections[2].body) || '');
  const parts = [title, stage, scene].filter(Boolean);
  const composed = truncateText(parts.join(' — '), 160);
  return composed || ui.defaultDescription(String(day && day.date ? day.date : ''));
}

function buildPrologueNarrative(lang = 'it') {
  if (lang === 'en') {
    return [
      '**Title**',
      'Prologue: leaving before leaving.',
      '',
      '**Where I was / stage**',
      'June 2 and 3 were the approach days: from Perugia to Bergamo, then an evening flight to Lourdes.',
      '',
      '**Key scene**',
      'The Camino started before the trail. On June 2 I went from Perugia to Milan with a friend who was heading to Milan that same day; along the way we had picked up other people through BlaBlaCar, and the trip passed quickly through interesting conversations. Then I continued from Milan to Bergamo by train to reach friends who would host me for one night. For the Camino I had considered bringing a tent, but in the hours right before departure, while I was packing my backpack, I realized it would be too bulky and heavy for the backpack balance, so I did not bring it and kept only the sleeping bag in my backpack. On the morning of June 3, in Bergamo, I went for a bike ride: light air, slow pace, and at the end of a path, near a stagnant stretch of the Brembo River, I encountered donkeys. In the evening I took the flight: I landed in Lourdes late and had not organized accommodation. I could not find a place to sleep, and every place I reached was already closed or had no reception. It was objectively worrying because I really had nowhere to stay for the night, but I was not anxious at all: I had the sleeping bag and had no problem sleeping outside, homeless style. From that point on, it was no longer preparation, it was the real start.',
      '',
      '**What I understood**',
      'The first step of the Camino does not coincide with the first kilometer on foot: it begins in logistical choices, in waiting, and in the way you prepare yourself for the journey.',
      '',
      '**Practical note**',
      'Transfer Perugia-Milan by BlaBlaCar, Milan-Bergamo by train, night in Bergamo hosted by friends, then evening flight on June 3.'
    ].join('\n');
  }
  if (lang === 'es') {
    return [
      '**Título**',
      'Prólogo: partir antes de partir.',
      '',
      '**Dónde estaba / etapa**',
      'El 2 y el 3 de junio fueron los días de aproximación: de Perugia a Bérgamo, luego vuelo nocturno hacia Lourdes.',
      '',
      '**Escena clave**',
      'El camino empezó antes del sendero. El 2 de junio hice Perugia-Milán con un amigo que iba a Milán ese mismo día; durante el viaje habíamos recogido a otras personas con BlaBlaCar y el trayecto pasó rápido entre conversaciones interesantes. Luego seguí de Milán a Bérgamo en tren para llegar a unos amigos que me alojarían una noche. Para el camino había pensado llevar tienda, pero en las horas previas a la salida, justo mientras preparaba la mochila, entendí que sería demasiado voluminosa y pesada para el equilibrio de la mochila, así que no la llevé, dejando en la mochila solo el saco de dormir. La mañana del 3, en Bérgamo, di una vuelta en bici: aire ligero, ritmo lento, y al final de un sendero, cerca de un estancamiento del río Brembo, me encontré con unos burros. Por la tarde tomé el vuelo: aterricé en Lourdes tarde y no había organizado alojamiento. No conseguía encontrar dónde dormir y los sitios que encontraba, cuando llegaba, estaban todos cerrados o sin recepción. Era preocupante, porque no tenía realmente dónde pasar la noche, pero no estaba nada ansioso: tenía el saco de dormir y no tenía ningún problema en dormir fuera, homeless style. Desde ahí ya no era preparación, era el inicio real.',
      '',
      '**Una cosa que entendí**',
      'El primer paso del camino no coincide con el primer kilómetro a pie: empieza en las decisiones logísticas, en la espera y en cómo te preparas para el viaje.',
      '',
      '**Nota práctica**',
      'Traslado Perugia-Milán con BlaBlaCar, tren Milán-Bérgamo, noche en Bérgamo con amigos y luego vuelo nocturno del 3 de junio.'
    ].join('\n');
  }
  if (lang === 'fr') {
    return [
      '**Titre**',
      'Prologue : partir avant de partir.',
      '',
      '**Où j’étais / étape**',
      'Les 2 et 3 juin ont été les jours d’approche : de Pérouse à Bergame, puis vol du soir vers Lourdes.',
      '',
      '**Scène clé**',
      'Le chemin a commencé avant le sentier. Le 2 juin, j’ai fait Pérouse-Milan avec un ami qui allait à Milan ce jour-là ; pendant le trajet, nous avions pris d’autres personnes via BlaBlaCar, et le voyage est passé vite entre discussions intéressantes. Ensuite, j’ai continué de Milan à Bergame en train pour rejoindre des amis qui m’hébergeaient une nuit. Pour le chemin, j’avais envisagé d’emporter une tente, mais dans les heures avant le départ, au moment de préparer mon sac, j’ai compris qu’elle serait trop encombrante et trop lourde pour l’équilibre du sac ; je ne l’ai donc pas prise, en gardant seulement le sac de couchage dans le sac. Le matin du 3, à Bergame, j’ai fait un tour à vélo : air léger, rythme lent, et au bout d’un sentier, près d’une retenue stagnante de la rivière Brembo, j’ai croisé des ânes. Le soir, j’ai pris l’avion : je suis arrivé tard à Lourdes et je n’avais pas organisé d’hébergement. Je n’arrivais pas à trouver où dormir et les lieux que je trouvais, une fois sur place, étaient déjà fermés ou sans réception. C’était inquiétant, parce que je n’avais pas réellement d’endroit pour la nuit, mais je n’étais pas du tout anxieux : j’avais le sac de couchage et je n’avais aucun problème à dormir dehors, homeless style. À partir de là, ce n’était plus de la préparation, c’était le vrai début.',
      '',
      '**Ce que j’ai compris**',
      'Le premier pas du chemin ne coïncide pas avec le premier kilomètre à pied : il commence dans les choix logistiques, dans l’attente et dans la manière de se disposer au voyage.',
      '',
      '**Note pratique**',
      'Trajet Pérouse-Milan en BlaBlaCar, train Milan-Bergame, nuit à Bergame chez des amis, puis vol du soir du 3 juin.'
    ].join('\n');
  }
  return [
    '**Titolo**',
    'Prologo: partire prima di partire.',
    '',
    '**Dove ero / tappa**',
    'Il 2 e il 3 giugno sono stati i giorni di avvicinamento: da Perugia a Bergamo, poi volo serale verso Lourdes.',
    '',
    '**Scena chiave**',
    'Il cammino è iniziato prima del sentiero. Il 2 giugno ho fatto Perugia-Milano con un mio amico che andava a Milano proprio quel giorno; lungo il viaggio avevamo caricato altre persone su BlaBlaCar e il tragitto è passato veloce tra chiacchiere interessanti. Poi ho proseguito da Milano a Bergamo in treno per raggiungere amici che mi avrebbero ospitato una notte. Per il cammino avevo considerato di portare la tenda, ma nelle ore precedenti alla partenza, proprio mentre stavo preparando lo zaino, ho capito che sarebbe stata troppo ingombrante e pesante per l’equilibrio dello zaino, quindi non l’ho portata, tenendo nello zaino solo il sacco a pelo. Il 3 mattina, a Bergamo, ho fatto un giro in bici: aria leggera, ritmo lento, e alla fine di un sentiero, vicino a un ristagnamento del fiume Brembo, ho incontrato degli asini. In serata ho preso il volo: sono atterrato a Lourdes tardi e non avevo organizzato l’alloggio. Non riuscivo a trovare posto per dormire e i posti che trovavo, una volta arrivato lì, erano già tutti chiusi o senza reception. Era una cosa preoccupante, perché non avevo realmente un posto dove stare la notte, ma non ero per nulla in ansia: avevo il sacco a pelo e non avevo alcun problema a dormire fuori, homeless style. Da lì in poi non era più preparazione, era inizio vero.',
    '',
    '**Una cosa che ho capito**',
    'Il primo passo del cammino non coincide con il primo chilometro a piedi: comincia nelle scelte logistiche, nell’attesa e nel modo in cui ti predisponi al viaggio.',
    '',
    '**Nota pratica**',
    'Trasferimento Perugia-Milano con BlaBlaCar, treno Milano-Bergamo, notte a Bergamo da amici, poi volo serale del 3 giugno.'
  ].join('\n');
}

function mergePrologueDay(days, lang = 'it') {
  const source = Array.isArray(days)
    ? days.filter((day) => PROLOGUE_DATES.includes(String(day && day.date ? day.date : '').slice(0, 10)))
    : [];
  if (!source.length) return null;
  const notes = buildPrologueNarrative(lang);
  const recommendations = Array.from(new Set(
    source.flatMap((day) => (Array.isArray(day && day.recommendations) ? day.recommendations : []))
      .map((entry) => JSON.stringify(entry))
  )).map((entry) => {
    try { return JSON.parse(entry); } catch { return null; }
  }).filter(Boolean);
  const items = source
    .flatMap((day) => (Array.isArray(day && day.items) ? day.items : []).map((item) => ({
      ...item,
      date: String(item && item.date ? item.date : day && day.date ? day.date : '')
    })))
    .sort((a, b) => {
      const left = `${String(a && a.date ? a.date : '')} ${String(a && a.time ? a.time : '')} ${String(a && a.orig ? a.orig : '')}`;
      const right = `${String(b && b.date ? b.date : '')} ${String(b && b.time ? b.time : '')} ${String(b && b.orig ? b.orig : '')}`;
      return left.localeCompare(right);
    });
  return {
    date: PROLOGUE_TRACK_DATE,
    notes,
    recommendations,
    items
  };
}

function normalizeImageCandidate(item) {
  if (!item || typeof item !== 'object') return '';
  const thumb = mediaPath(item, 'thumb');
  const src = mediaPath(item, 'src');
  const poster = mediaPath(item, 'poster');
  return thumb || poster || src;
}

async function readDayOgOverrides() {
  try {
    const raw = await fs.readFile(DAY_OG_OVERRIDES_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    Object.entries(parsed).forEach(([day, value]) => {
      const key = String(day || '').slice(0, 10);
      const mediaId = String(value || '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(key) && mediaId) out[key] = mediaId;
    });
    return out;
  } catch {
    return {};
  }
}

async function writeDayOgOverrides(overrides) {
  const normalized = {};
  Object.entries(overrides || {}).forEach(([day, value]) => {
    const key = String(day || '').slice(0, 10);
    const mediaId = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(key) && mediaId) normalized[key] = mediaId;
  });
  await fs.mkdir(path.dirname(DAY_OG_OVERRIDES_PATH), { recursive: true });
  await fs.writeFile(DAY_OG_OVERRIDES_PATH, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
}

function normalizeDayOgOverrides(raw) {
  const normalized = {};
  Object.entries(raw || {}).forEach(([day, value]) => {
    const key = String(day || '').trim().slice(0, 10);
    const mediaId = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(key) && mediaId) normalized[key] = mediaId;
  });
  return normalized;
}

function resolveDayOgImagePath(day, overrides) {
  const date = String(day && day.date ? day.date : '').slice(0, 10);
  const items = Array.isArray(day && day.items) ? day.items : [];
  const overrideId = String(overrides && overrides[date] ? overrides[date] : '').trim();
  if (!overrideId) return '/assets/og-image.jpg';
  const item = items.find((entry) => String(entry && entry.id ? entry.id : '') === overrideId);
  if (!item) return '/assets/og-image.jpg';
  if (String(item.type || '') === 'video') {
    return mediaPath(item, 'poster', date) || mediaPath(item, 'thumb', date) || '/assets/og-image.jpg';
  }
  return mediaPath(item, 'src', date) || mediaPath(item, 'thumb', date) || '/assets/og-image.jpg';
}

function normalizeAssetPathByItem(item, field, fallbackDate = '') {
  const raw = String(item && item[field] ? item[field] : '').trim();
  if (!raw) return '';
  const date = String(
    item && item.date
      ? item.date
      : fallbackDate
  ).slice(0, 10);
  const normalized = raw.startsWith('/') ? raw : `/${raw.replace(/^\.?\//, '')}`;
  if (/^(?:[a-z]+:)?\/\//i.test(normalized) || normalized.startsWith('data:') || normalized.startsWith('blob:')) {
    return normalized;
  }
  const alreadyDated = /^\/assets\/(img|thumb|poster|video_resized)\/\d{4}-\d{2}-\d{2}\/[^/]+$/i.test(normalized);
  if (alreadyDated) return normalized;
  const fileName = normalized.split('/').pop() || '';
  const kindFromField = field === 'src'
    ? ((String(item && item.type ? item.type : '') === 'video') ? 'video_resized' : 'img')
    : (field === 'thumb' ? 'thumb' : 'poster');
  const kindMatch = normalized.match(/^\/assets\/(img|thumb|poster|video_resized)\//i);
  const kind = kindMatch ? String(kindMatch[1]).toLowerCase() : kindFromField;
  if (date && fileName) return `/assets/${kind}/${date}/${fileName}`;
  return normalized;
}

function mediaPath(item, field, fallbackDate = '') {
  const raw = String(item && item[field] ? item[field] : '').trim();
  if (!raw) return '';
  if (/^(?:[a-z]+:)?\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
  return normalizeAssetPathByItem(item, field, fallbackDate);
}

function buildVideoDurationLabel(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total <= 0) return '';
  const s = Math.round(total);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

const TRACK_PHOTO_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp']);
const trackDayPointsCache = new Map();
const canonicalStageSummaryCache = new Map();

function selectTrackPointsForMap(points) {
  const raw = (Array.isArray(points) ? points : [])
    .map((point) => {
      const lat = Number(point && point.lat);
      const lon = Number(point && point.lon);
      const ts = Date.parse(String(point && point.time ? point.time : ''));
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Number.isNaN(ts)) return null;
      const file = String(point && point.file ? point.file : '').trim();
      const lower = file.toLowerCase();
      if (lower.includes('.')) {
        const ext = lower.split('.').pop();
        if (!TRACK_PHOTO_EXTENSIONS.has(ext)) return null;
      }
      return { lat, lon, ts, file };
    })
    .filter(Boolean);
  if (!raw.length) return [];
  const hasRuntastic = raw.some((point) => String(point.file || '').startsWith('RUNTASTIC_'));
  const source = hasRuntastic
    ? raw.filter((point) => String(point.file || '').startsWith('RUNTASTIC_'))
    : raw;
  source.sort((a, b) => a.ts - b.ts);
  return source;
}

async function readTrackDayPointsForMap(dayKey) {
  const key = String(dayKey || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return [];
  if (trackDayPointsCache.has(key)) return trackDayPointsCache.get(key);
  const promise = readJson(path.join(ROOT, 'data', 'tracks', 'day', `${key}.json`), null)
    .then((payload) => selectTrackPointsForMap(payload && payload.points))
    .catch(() => []);
  trackDayPointsCache.set(key, promise);
  return promise;
}

async function buildCanonicalStageSummary(days, lang) {
  const list = Array.isArray(days) ? days : [];
  const cacheKey = `${lang}|${list.map((day) => String(day && day.date ? day.date : '').slice(0, 10)).join(',')}`;
  if (canonicalStageSummaryCache.has(cacheKey)) return canonicalStageSummaryCache.get(cacheKey);
  const labelPrefix = ({
    it: 'Giorno',
    en: 'Day',
    es: 'Dia',
    fr: 'Jour'
  })[lang] || 'Day';
  const promise = (async () => {
    const summary = [];
    for (let index = 0; index < list.length; index += 1) {
      const day = list[index];
      const pageDate = String(day && day.date ? day.date : '').slice(0, 10);
      if (PROLOGUE_DATES.includes(pageDate)) continue;
      const trackKey = String(day && day.trackDate ? day.trackDate : pageDate).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(pageDate) || !/^\d{4}-\d{2}-\d{2}$/.test(trackKey)) continue;
      const points = await readTrackDayPointsForMap(trackKey);
      if (!points.length) continue;
      const first = points[0];
      const last = points[points.length - 1];
      summary.push({
        dayKey: trackKey,
        href: `/${lang}/day/${pageDate}/`,
        label: `${labelPrefix} ${index + 1}`,
        start: { lat: Number(first.lat), lon: Number(first.lon) },
        end: { lat: Number(last.lat), lon: Number(last.lon) }
      });
    }
    return summary;
  })();
  canonicalStageSummaryCache.set(cacheKey, promise);
  return promise;
}

async function buildCanonicalDayMapData(days, lang, currentDayKey, items) {
  const stages = await buildCanonicalStageSummary(days, lang);
  const mediaItems = (Array.isArray(items) ? items : [])
    .map((item) => {
      const id = String(item && item.id ? item.id : '').trim();
      const lat = Number(item && item.lat);
      const lon = Number(item && item.lon);
      if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return {
        id,
        lat,
        lon,
        type: String(item && item.type ? item.type : '').trim(),
        time: String(item && item.time ? item.time : '').trim(),
        place: String(item && item.place ? item.place : '').trim()
      };
    })
    .filter(Boolean);
  return {
    currentDayKey: String(currentDayKey || '').slice(0, 10),
    stages,
    mediaItems
  };
}

function localizeMapHtml(rawHtml, locale, req) {
  const lang = SUPPORTED_LANGS.has(String(locale || '').toLowerCase())
    ? String(locale).toLowerCase()
    : 'it';
  const origin = getRequestOrigin(req);
  const MAP_SEO = {
    it: {
      title: 'Cammino di Santiago — Mappa',
      desc: 'Mappa interattiva del Cammino di Santiago con punti media giornalieri.'
    },
    en: {
      title: 'Camino de Santiago — Map',
      desc: 'Interactive map of the Camino de Santiago route with daily media points.'
    },
    es: {
      title: 'Camino de Santiago — Mapa',
      desc: 'Mapa interactivo del Camino de Santiago con puntos de medios diarios.'
    },
    fr: {
      title: 'Chemin de Saint-Jacques — Carte',
      desc: 'Carte interactive du Chemin de Saint-Jacques avec points média quotidiens.'
    }
  };
  const title = (MAP_SEO[lang] || MAP_SEO.it).title;
  const desc = (MAP_SEO[lang] || MAP_SEO.it).desc;
  const MAP_UI = {
    it: {
      eyebrow: 'Mappa del percorso',
      heading: 'Cammino di Santiago',
      lead: 'Traccia ricavata dai metadati GPS delle foto e dei video.',
      back: 'Torna al diario',
      close: 'Chiudi'
    },
    en: {
      eyebrow: 'Route map',
      heading: 'Camino de Santiago',
      lead: 'Track derived from GPS metadata in photos and videos.',
      back: 'Back to diary',
      close: 'Close'
    },
    es: {
      eyebrow: 'Mapa del recorrido',
      heading: 'Camino de Santiago',
      lead: 'Trazado obtenido de los metadatos GPS de fotos y vídeos.',
      back: 'Volver al diario',
      close: 'Cerrar'
    },
    fr: {
      eyebrow: 'Carte du parcours',
      heading: 'Chemin de Saint-Jacques',
      lead: 'Tracé issu des métadonnées GPS des photos et vidéos.',
      back: 'Retour au journal',
      close: 'Fermer'
    }
  };
  const ui = MAP_UI[lang] || MAP_UI.it;
  const canonical = `${origin}/${lang}/map/`;
  const altIt = `${origin}/it/map/`;
  const altEn = `${origin}/en/map/`;
  const altEs = `${origin}/es/map/`;
  const altFr = `${origin}/fr/map/`;
  let out = String(rawHtml || '');
  out = out.replace(/<html lang="[^"]*">/i, `<html lang="${lang}">`);
  out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  if (/<meta[^>]*name="description"/i.test(out)) {
    out = out.replace(/(<meta[^>]*name="description"[^>]*content=")[^"]*(")/i, `$1${escapeHtml(desc)}$2`);
  } else {
    out = out.replace('</head>', `  <meta name="description" content="${escapeHtml(desc)}" />\n</head>`);
  }
  if (/<link[^>]*rel="canonical"/i.test(out)) {
    out = out.replace(/(<link[^>]*rel="canonical"[^>]*href=")[^"]*(")/i, `$1${escapeHtml(canonical)}$2`);
  } else {
    out = out.replace('</head>', `  <link rel="canonical" href="${escapeHtml(canonical)}" />\n</head>`);
  }
  out = out.replace('</head>', `  <link rel="alternate" hreflang="it" href="${escapeHtml(altIt)}" />\n  <link rel="alternate" hreflang="en" href="${escapeHtml(altEn)}" />\n  <link rel="alternate" hreflang="es" href="${escapeHtml(altEs)}" />\n  <link rel="alternate" hreflang="fr" href="${escapeHtml(altFr)}" />\n  <link rel="alternate" hreflang="x-default" href="${escapeHtml(altIt)}" />\n</head>`);
  out = out.replace(/<span class="eyebrow">[\s\S]*?<\/span>/i, `<span class="eyebrow">${escapeHtml(ui.eyebrow)}</span>`);
  out = out.replace(/<h1>[\s\S]*?<\/h1>/i, `<h1>${escapeHtml(ui.heading)}</h1>`);
  out = out.replace(/<p class="lead">[\s\S]*?<\/p>/i, `<p class="lead">${escapeHtml(ui.lead)}</p>`);
  out = out.replace(/<a class="view-btn active" href="[^"]*">[\s\S]*?<\/a>/i, `<a class="view-btn active" href="/${lang}/">${escapeHtml(ui.back)}</a>`);
  out = out.replace(/(<button[^>]*id="map-media-modal-close"[^>]*aria-label=")[^"]*(")/i, `$1${escapeHtml(ui.close)}$2`);
  return out;
}

function localizePeopleHtml(rawHtml, locale, req) {
  const lang = SUPPORTED_LANGS.has(String(locale || '').toLowerCase())
    ? String(locale).toLowerCase()
    : 'it';
  const origin = getRequestOrigin(req);
  const PEOPLE_SEO = {
    it: {
      title: 'Cammino di Santiago — Persone',
      desc: 'Persone incontrate sul Cammino di Santiago, ricostruite dalle note giornaliere.'
    },
    en: {
      title: 'Camino de Santiago — People',
      desc: 'People met on the Camino de Santiago, reconstructed from the daily notes.'
    },
    es: {
      title: 'Camino de Santiago — Personas',
      desc: 'Personas encontradas en el Camino de Santiago, reconstruidas a partir de las notas diarias.'
    },
    fr: {
      title: 'Chemin de Saint-Jacques — Personnes',
      desc: 'Personnes rencontrées sur le Chemin de Saint-Jacques, reconstituées à partir des notes quotidiennes.'
    }
  };
  const PEOPLE_UI = {
    it: {
      eyebrow: 'Geografia umana del cammino',
      heading: 'Persone del Cammino',
      lead: 'Una pagina dedicata agli incontri che ritornano, si intrecciano e diventano parte della storia.',
      back: 'Torna al diario'
    },
    en: {
      eyebrow: 'Human map of the Camino',
      heading: 'People on the Camino',
      lead: 'A dedicated page for the encounters that return, intertwine, and become part of the story.',
      back: 'Back to diary'
    },
    es: {
      eyebrow: 'Geografía humana del Camino',
      heading: 'Personas del Camino',
      lead: 'Una página dedicada a los encuentros que vuelven, se cruzan y terminan formando parte de la historia.',
      back: 'Volver al diario'
    },
    fr: {
      eyebrow: 'Géographie humaine du Chemin',
      heading: 'Personnes du Chemin',
      lead: 'Une page dédiée aux rencontres qui reviennent, se croisent et deviennent une partie de l’histoire.',
      back: 'Retour au journal'
    }
  };
  const title = (PEOPLE_SEO[lang] || PEOPLE_SEO.it).title;
  const desc = (PEOPLE_SEO[lang] || PEOPLE_SEO.it).desc;
  const ui = PEOPLE_UI[lang] || PEOPLE_UI.it;
  const canonical = `${origin}/${lang}/people/`;
  const altIt = `${origin}/it/people/`;
  const altEn = `${origin}/en/people/`;
  const altEs = `${origin}/es/people/`;
  const altFr = `${origin}/fr/people/`;
  let out = String(rawHtml || '');
  out = out.replace(/<html lang="[^"]*">/i, `<html lang="${lang}">`);
  out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  if (/<meta[^>]*name="description"/i.test(out)) {
    out = out.replace(/(<meta[^>]*name="description"[^>]*content=")[^"]*(")/i, `$1${escapeHtml(desc)}$2`);
  } else {
    out = out.replace('</head>', `  <meta name="description" content="${escapeHtml(desc)}" />\n</head>`);
  }
  if (/<link[^>]*rel="canonical"/i.test(out)) {
    out = out.replace(/(<link[^>]*rel="canonical"[^>]*href=")[^"]*(")/i, `$1${escapeHtml(canonical)}$2`);
  } else {
    out = out.replace('</head>', `  <link rel="canonical" href="${escapeHtml(canonical)}" />\n</head>`);
  }
  out = out.replace('</head>', `  <link rel="alternate" hreflang="it" href="${escapeHtml(altIt)}" />\n  <link rel="alternate" hreflang="en" href="${escapeHtml(altEn)}" />\n  <link rel="alternate" hreflang="es" href="${escapeHtml(altEs)}" />\n  <link rel="alternate" hreflang="fr" href="${escapeHtml(altFr)}" />\n  <link rel="alternate" hreflang="x-default" href="${escapeHtml(altIt)}" />\n</head>`);
  out = out.replace(/<span class="eyebrow"[^>]*>[\s\S]*?<\/span>/i, `<span class="eyebrow">${escapeHtml(ui.eyebrow)}</span>`);
  out = out.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, `<h1>${escapeHtml(ui.heading)}</h1>`);
  out = out.replace(/<p class="lead"[^>]*>[\s\S]*?<\/p>/i, `<p class="lead">${escapeHtml(ui.lead)}</p>`);
  out = out.replace(/<a class="view-btn active" href="[^"]*">[\s\S]*?<\/a>/i, `<a class="view-btn active" href="/${lang}/">${escapeHtml(ui.back)}</a>`);
  return out;
}

function formatDisplayDate(dateValue, lang) {
  const [y, m, d] = String(dateValue || '').split('-').map((v) => Number(v));
  if (!y || !m || !d) return String(dateValue || '');
  const dt = new Date(Date.UTC(y, m - 1, d));
  try {
    const localeMap = {
      it: 'it-IT',
      en: 'en-US',
      es: 'es-ES',
      fr: 'fr-FR'
    };
    return dt.toLocaleDateString(localeMap[lang] || 'it-IT', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC'
    });
  } catch {
    return String(dateValue || '');
  }
}

function formatDisplayDateShort(dateValue, lang) {
  const [y, m, d] = String(dateValue || '').split('-').map((v) => Number(v));
  if (!y || !m || !d) return String(dateValue || '');
  const dt = new Date(Date.UTC(y, m - 1, d));
  try {
    const localeMap = {
      it: 'it-IT',
      en: 'en-US',
      es: 'es-ES',
      fr: 'fr-FR'
    };
    return dt.toLocaleDateString(localeMap[lang] || 'it-IT', {
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC'
    });
  } catch {
    return String(dateValue || '');
  }
}

function buildDayLabel(lang, dayNumber) {
  const prefixByLang = {
    it: 'Giorno',
    en: 'Day',
    es: 'Dia',
    fr: 'Jour'
  };
  const prefix = prefixByLang[lang] || prefixByLang.it;
  const num = Number(dayNumber);
  if (!Number.isFinite(num) || num <= 0) return prefix;
  return `${prefix} ${num}`;
}

function renderRecommendations(recommendations) {
  const list = Array.isArray(recommendations) ? recommendations : [];
  if (!list.length) return '';
  const items = list
    .map((entry) => {
      const name = escapeHtml(entry && entry.name ? entry.name : '');
      const note = entry && entry.note ? markdownToSafeHtml(entry.note) : '';
      const href = entry && entry.url ? escapeHtml(entry.url) : '';
      if (!name) return '';
      if (href) {
        return `<li><a href="${href}" target="_blank" rel="noopener noreferrer">${name}</a>${note ? `<div class="rec-note">${note}</div>` : ''}</li>`;
      }
      return `<li>${name}${note ? `<div class="rec-note">${note}</div>` : ''}</li>`;
    })
    .filter(Boolean)
    .join('\n');
  if (!items) return '';
  return `<section class="day-section"><h2>__RECOMMENDATIONS_HEADING__</h2><ul>${items}</ul></section>`;
}

function buildDayPageHtml({ origin, lang, day, prevDay, nextDay, dayOgOverrides, options = {} }) {
  const DAY_UI = {
    it: {
      titlePrefix: 'Diario Cammino',
      defaultDescription: () => 'Pagina diario del Cammino di Santiago con foto, video, GPS e note del giorno.',
      dayLabelPrefix: 'Giorno',
      prologueBadge: 'Prologo',
      noMetadata: 'Nessun metadato',
      comments: 'Commenti',
      backToDiary: 'Torna al diario',
      openInteractiveDiary: 'Apri nel diario interattivo',
      openMap: 'Apri mappa',
      miniMap: 'Percorso del giorno',
      journeyOverview: 'Panoramica del Cammino',
      dayNotes: 'Note del giorno',
      noNotes: 'Nessuna nota disponibile.',
      dayTrackEmpty: 'Nessun GPS per questo giorno.',
      dayTrackLoading: 'Caricamento mappa del giorno...',
      mediaHeading: 'Media',
      noMedia: 'Nessun media per questo giorno.',
      close: 'Chiudi',
      prev: 'Precedente',
      next: 'Successivo',
      zoomOut: 'Riduci zoom',
      zoomIn: 'Aumenta zoom',
      name: 'Nome',
      writeComment: 'Scrivi un commento',
      send: 'Invia',
      commentsEmpty: 'Nessun commento per ora.',
      commentsOnDay: 'Commenti sulla nota del giorno',
      commentsOnMedia: 'Commenti sul media',
      commentsLoading: 'Caricamento commenti...',
      commentsLoadError: 'Errore nel caricamento commenti',
      commentsSaveError: 'Errore durante il salvataggio commento',
      recommendations: 'Posti consigliati',
      offerCtaTitle: 'Stai pianificando anche tu un cammino?',
      offerCtaText: 'Se vuoi trasformare il tuo viaggio in un diario interattivo con mappa, media e tappe ordinate, qui trovi come funziona.',
      offerCtaLink: 'Scopri come funziona'
    },
    en: {
      titlePrefix: 'Camino Diary',
      defaultDescription: () => 'Camino de Santiago diary entry with photos, videos, GPS and daily notes.',
      dayLabelPrefix: 'Day',
      prologueBadge: 'Prologue',
      noMetadata: 'No metadata',
      comments: 'Comments',
      backToDiary: 'Back to diary',
      openInteractiveDiary: 'Open in interactive diary',
      openMap: 'Open map',
      miniMap: 'Daily route',
      journeyOverview: 'Journey overview',
      dayNotes: 'Day Notes',
      noNotes: 'No notes available.',
      dayTrackEmpty: 'No GPS for this day.',
      dayTrackLoading: 'Loading day map...',
      mediaHeading: 'Media',
      noMedia: 'No media for this day.',
      close: 'Close',
      prev: 'Previous',
      next: 'Next',
      zoomOut: 'Zoom out',
      zoomIn: 'Zoom in',
      name: 'Name',
      writeComment: 'Write a comment',
      send: 'Send',
      commentsEmpty: 'No comments yet.',
      commentsOnDay: 'Comments on day note',
      commentsOnMedia: 'Comments on media',
      commentsLoading: 'Loading comments...',
      commentsLoadError: 'Failed to load comments',
      commentsSaveError: 'Failed to save comment',
      recommendations: 'Recommended places',
      offerCtaTitle: 'Do you like this format?',
      offerCtaText: 'If you want to turn your own trip into an interactive diary with map, media and ordered stages, see how it works.',
      offerCtaLink: 'See how it works'
    },
    es: {
      titlePrefix: 'Diario del Camino',
      defaultDescription: () => 'Página del diario del Camino de Santiago con fotos, vídeos, GPS y notas del día.',
      dayLabelPrefix: 'Dia',
      prologueBadge: 'Prólogo',
      noMetadata: 'Sin metadatos',
      comments: 'Comentarios',
      backToDiary: 'Volver al diario',
      openInteractiveDiary: 'Abrir en el diario interactivo',
      openMap: 'Abrir mapa',
      miniMap: 'Ruta del día',
      journeyOverview: 'Vista general del Camino',
      dayNotes: 'Notas del día',
      noNotes: 'No hay notas disponibles.',
      dayTrackEmpty: 'No hay GPS para este día.',
      dayTrackLoading: 'Cargando mapa del día...',
      mediaHeading: 'Media',
      noMedia: 'No hay media para este día.',
      close: 'Cerrar',
      prev: 'Anterior',
      next: 'Siguiente',
      zoomOut: 'Alejar zoom',
      zoomIn: 'Acercar zoom',
      name: 'Nombre',
      writeComment: 'Escribe un comentario',
      send: 'Enviar',
      commentsEmpty: 'Aún no hay comentarios.',
      commentsOnDay: 'Comentarios sobre la nota del día',
      commentsOnMedia: 'Comentarios sobre el media',
      commentsLoading: 'Cargando comentarios...',
      commentsLoadError: 'Error al cargar comentarios',
      commentsSaveError: 'Error al guardar el comentario',
      recommendations: 'Lugares recomendados',
      offerCtaTitle: '¿Te gusta este formato?',
      offerCtaText: 'Si quieres transformar también tu viaje en un diario interactivo con mapa, media y etapas ordenadas, mira cómo funciona.',
      offerCtaLink: 'Descubre cómo funciona'
    },
    fr: {
      titlePrefix: 'Journal du Chemin',
      defaultDescription: () => 'Page du journal du Chemin de Saint-Jacques avec photos, vidéos, GPS et notes du jour.',
      dayLabelPrefix: 'Jour',
      prologueBadge: 'Prologue',
      noMetadata: 'Aucune métadonnée',
      comments: 'Commentaires',
      backToDiary: 'Retour au journal',
      openInteractiveDiary: 'Ouvrir dans le journal interactif',
      openMap: 'Ouvrir la carte',
      miniMap: 'Parcours du jour',
      journeyOverview: 'Vue d\'ensemble du Chemin',
      dayNotes: 'Notes du jour',
      noNotes: 'Aucune note disponible.',
      dayTrackEmpty: 'Aucun GPS pour ce jour.',
      dayTrackLoading: 'Chargement de la carte du jour...',
      mediaHeading: 'Médias',
      noMedia: 'Aucun média pour ce jour.',
      close: 'Fermer',
      prev: 'Précédent',
      next: 'Suivant',
      zoomOut: 'Zoom arrière',
      zoomIn: 'Zoom avant',
      name: 'Nom',
      writeComment: 'Écrire un commentaire',
      send: 'Envoyer',
      commentsEmpty: 'Aucun commentaire pour le moment.',
      commentsOnDay: 'Commentaires sur la note du jour',
      commentsOnMedia: 'Commentaires sur le média',
      commentsLoading: 'Chargement des commentaires...',
      commentsLoadError: 'Erreur de chargement des commentaires',
      commentsSaveError: 'Erreur lors de l’enregistrement du commentaire',
      recommendations: 'Lieux conseillés',
      offerCtaTitle: 'Ce format vous plaît ?',
      offerCtaText: 'Si vous voulez transformer votre voyage en journal interactif avec carte, médias et étapes ordonnées, regardez comment cela fonctionne.',
      offerCtaLink: 'Voir comment ça marche'
    }
  };
  const ui = DAY_UI[lang] || DAY_UI.it;
  const date = String(day && day.date ? day.date : '');
  const displayDate = String(options.displayDate || formatDisplayDateShort(date, lang));
  const canonicalPath = String(options.canonicalPath || `/${lang}/day/${date}/`);
  const canonicalUrl = buildAbsoluteUrl(origin, canonicalPath);
  const altPaths = options.altPaths || {
    it: `/it/day/${date}/`,
    en: `/en/day/${date}/`,
    es: `/es/day/${date}/`,
    fr: `/fr/day/${date}/`
  };
  const altItUrl = buildAbsoluteUrl(origin, String(altPaths.it || `/it/day/${date}/`));
  const altEnUrl = buildAbsoluteUrl(origin, String(altPaths.en || `/en/day/${date}/`));
  const altEsUrl = buildAbsoluteUrl(origin, String(altPaths.es || `/es/day/${date}/`));
  const altFrUrl = buildAbsoluteUrl(origin, String(altPaths.fr || `/fr/day/${date}/`));
  const noteSections = parseNoteSections(day && day.notes ? day.notes : '');
  const noteTitle = String((noteSections[0] && noteSections[0].body) || '').trim();
  const dayNumber = Number.isInteger(options.dayNumber) ? options.dayNumber : null;
  const stageLabel = String(options.stageLabel || (dayNumber ? buildDayLabel(lang, dayNumber) : ui.prologueBadge || ''));
  const diaryPath = String(options.diaryPath || `/${lang}/?day=${encodeURIComponent(date)}`);
  const diaryUrl = buildAbsoluteUrl(origin, diaryPath);
  const trackDayKey = String(options.trackDayKey || (day && day.trackDate ? day.trackDate : date)).slice(0, 10);
  const showTrackCard = options.showTrackCard === undefined ? Boolean(trackDayKey) : Boolean(options.showTrackCard);
  const trackMapPath = String(options.trackMapPath || (trackDayKey ? `/${lang}/map/?day=${encodeURIComponent(trackDayKey)}` : `/${lang}/map/`));
  const dayMapData = options.dayMapData && typeof options.dayMapData === 'object' ? options.dayMapData : null;
  const dayMapDataJson = JSON.stringify(dayMapData || null).replace(/</g, '\\u003c');
  const offerPath = String(options.offerPath || `/${lang}/crea-il-tuo-diario/`);
  const pageTitle = String(options.pageTitle || buildDaySeoTitle(day, lang, ui, { stageLabel, dayNumber }));
  const description = String(options.description || buildDaySeoDescription(day, lang, ui));
  const commentTargetDate = String(options.commentTargetDate || date);
  const interactiveMediaBase = `${origin}${String(options.interactiveMediaBase || `/${lang}/?day=${encodeURIComponent(date)}&target=`)}`;
  const defaultHeaderTitle = stageLabel === String(ui.prologueBadge || '')
    ? (noteTitle || stageLabel)
    : (noteTitle ? `${stageLabel} - ${noteTitle}` : stageLabel);
  const headerTitle = String(options.headerTitle || defaultHeaderTitle);
  const defaultHeaderMeta = stageLabel === String(ui.prologueBadge || '')
    ? displayDate
    : displayDate;
  const headerMeta = String(options.headerMeta || defaultHeaderMeta);
  const items = Array.isArray(day && day.items) ? day.items : [];
  const ogImagePath = resolveDayOgImagePath(day, dayOgOverrides || {});
  const ogImageUrl = ogImagePath ? buildAbsoluteUrl(origin, `/${String(ogImagePath).replace(/^\/+/, '')}`) : '';
  const noteHtml = markdownToSafeHtml(day && day.notes ? day.notes : '');
  const recommendationsHtml = renderRecommendations(day && day.recommendations)
    .replace('__RECOMMENDATIONS_HEADING__', escapeHtml(ui.recommendations));
  const dayTrackHtml = showTrackCard ? `
  <section class="day-section">
    <div
      class="day-track day-track--canonical"
      data-day-track-key="${escapeHtml(trackDayKey)}"
      data-day-track-loading="${escapeHtml(ui.dayTrackLoading)}"
      data-day-track-empty="${escapeHtml(ui.dayTrackEmpty)}"
    >
      <div class="day-track__head">
        <span>${escapeHtml(ui.miniMap)}</span>
        <a class="day-track__open" href="${escapeHtml(trackMapPath)}">${escapeHtml(ui.openMap)}</a>
      </div>
      <div class="day-track__body is-empty" data-day-track-body>${escapeHtml(ui.dayTrackLoading)}</div>
      <div class="day-track__overview-head">
        <span>${escapeHtml(ui.journeyOverview)}</span>
      </div>
      <div class="day-track__overview is-empty" data-day-track-overview>${escapeHtml(ui.dayTrackLoading)}</div>
    </div>
  </section>` : '';
  const mediaCards = items.slice(0, 32).map((item) => {
    const isVideo = String(item.type || '') === 'video';
    const mediaImg = mediaPath(item, 'thumb', date) || mediaPath(item, 'poster', date) || mediaPath(item, 'src', date);
    const mediaUrl = buildAbsoluteUrl(origin, `/${String(mediaImg || '').replace(/^\/+/, '')}`);
    const mediaSrc = buildAbsoluteUrl(origin, `/${String(mediaPath(item, 'src', date) || mediaImg || '').replace(/^\/+/, '')}`);
    const mediaPoster = buildAbsoluteUrl(origin, `/${String(mediaPath(item, 'poster', date) || mediaImg || '').replace(/^\/+/, '')}`);
    const labelTimeRaw = String(item.time || '');
    const placeRaw = String(item.place || '');
    const labelTime = escapeHtml(labelTimeRaw);
    const place = escapeHtml(placeRaw);
    const id = escapeHtml(String(item.id || ''));
    const rawId = String(item.id || '').trim();
    const duration = isVideo ? buildVideoDurationLabel(item.durationSec) : '';
    const meta = [labelTime, place].filter(Boolean).join(' · ');
    const lat = Number.isFinite(Number(item && item.lat)) ? Number(item.lat) : null;
    const lon = Number.isFinite(Number(item && item.lon)) ? Number(item.lon) : null;
    const hasCoords = lat !== null && lon !== null;
    const mapsUrl = hasCoords
      ? `https://www.google.com/maps?q=${encodeURIComponent(String(lat))},${encodeURIComponent(String(lon))}`
      : '';
    const commentTarget = rawId ? `media-${rawId}` : '';
    const interactiveHref = rawId
      ? `${interactiveMediaBase}${encodeURIComponent(`media-${rawId}`)}`
      : `${origin}/${lang}/?day=${encodeURIComponent(date)}`;
    return `
      <article class="media-card">
        <a
          class="day-media-link"
          href="${escapeHtml(interactiveHref)}"
          aria-label="media ${id}"
          data-media-id="${id}"
          data-media-type="${isVideo ? 'video' : 'image'}"
          data-media-src="${escapeHtml(mediaSrc)}"
          data-media-poster="${escapeHtml(mediaPoster)}"
          data-media-meta="${escapeHtml(meta || ui.noMetadata)}"
        >
          ${mediaUrl ? `<img loading="lazy" src="${mediaUrl}" alt="${escapeHtml(`${headerTitle} ${meta}`)}" />` : '<div class="media-fallback"></div>'}
        </a>
        ${commentTarget ? `<button type="button" class="day-comment-btn day-comment-btn--media" data-comment-target="${escapeHtml(commentTarget)}">${ui.comments}</button>` : ''}
        <div class="media-card__meta">
          ${labelTimeRaw ? escapeHtml(labelTimeRaw) : ''}
          ${labelTimeRaw && placeRaw ? ' · ' : ''}
          ${placeRaw
            ? (mapsUrl
              ? `<a href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(placeRaw)}</a>`
              : escapeHtml(placeRaw))
            : ''}
          ${duration ? ` · video ${escapeHtml(duration)}` : ''}
        </div>
      </article>
    `;
  }).join('\n');

  const mediaJsonLd = items.slice(0, 20).map((item) => {
    const image = mediaPath(item, 'thumb', date) || mediaPath(item, 'poster', date) || mediaPath(item, 'src', date);
    if (!image) return null;
    const contentUrl = buildAbsoluteUrl(origin, `/${String(mediaPath(item, 'src', date) || image).replace(/^\/+/, '')}`);
    const thumbnailUrl = buildAbsoluteUrl(origin, `/${String(image).replace(/^\/+/, '')}`);
    const uploadDate = item.date && item.time ? `${item.date}T${item.time}:00` : undefined;
    if (String(item.type || '') === 'video') {
      return {
        '@type': 'VideoObject',
        name: item.orig || item.id || 'Video',
        uploadDate,
        contentUrl,
        thumbnailUrl,
        duration: Number.isFinite(Number(item.durationSec)) ? `PT${Math.max(1, Math.round(Number(item.durationSec)))}S` : undefined
      };
    }
    return {
      '@type': 'ImageObject',
      name: item.orig || item.id || 'Image',
      uploadDate,
      contentUrl,
      thumbnailUrl
    };
  }).filter(Boolean);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: pageTitle,
    description,
    datePublished: `${date}T00:00:00Z`,
    dateModified: `${date}T23:59:59Z`,
    inLanguage: lang,
    author: { '@type': 'Person', name: SITE_AUTHOR },
    mainEntityOfPage: canonicalUrl,
    image: ogImageUrl || undefined,
    hasPart: mediaJsonLd.length ? mediaJsonLd : undefined
  };

  const prevHref = options.prevHref === null ? '' : String(options.prevHref || (prevDay ? `/${lang}/day/${prevDay.date}/` : ''));
  const nextHref = options.nextHref === null ? '' : String(options.nextHref || (nextDay ? `/${lang}/day/${nextDay.date}/` : ''));
  const prevLabel = String(options.prevLabel || '');
  const nextLabel = String(options.nextLabel || '');
  const navPrev = prevHref ? `<a href="${escapeHtml(prevHref)}">← ${escapeHtml(prevLabel)}</a>` : '';
  const navNext = nextHref ? `<a href="${escapeHtml(nextHref)}">${escapeHtml(nextLabel)} →</a>` : '';

  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta name="robots" content="index,follow,max-image-preview:large" />
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
  <link rel="alternate" hreflang="it" href="${escapeHtml(altItUrl)}" />
  <link rel="alternate" hreflang="en" href="${escapeHtml(altEnUrl)}" />
  <link rel="alternate" hreflang="es" href="${escapeHtml(altEsUrl)}" />
  <link rel="alternate" hreflang="fr" href="${escapeHtml(altFrUrl)}" />
  <link rel="alternate" hreflang="x-default" href="${escapeHtml(altItUrl)}" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${escapeHtml(pageTitle)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
  ${ogImageUrl ? `<meta property="og:image" content="${escapeHtml(ogImageUrl)}" />` : ''}
  ${ogImageUrl ? `<meta property="og:image:width" content="${OG_IMAGE_WIDTH}" />` : ''}
  ${ogImageUrl ? `<meta property="og:image:height" content="${OG_IMAGE_HEIGHT}" />` : ''}
  ${ogImageUrl ? `<meta property="og:image:type" content="${OG_IMAGE_TYPE}" />` : ''}
  <meta name="twitter:card" content="${ogImageUrl ? 'summary_large_image' : 'summary'}" />
  <meta name="twitter:title" content="${escapeHtml(pageTitle)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  ${ogImageUrl ? `<meta name="twitter:image" content="${escapeHtml(ogImageUrl)}" />` : ''}
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="icon" href="/favicon.ico" sizes="any" />
  <link rel="icon" type="image/png" href="/favicon.png" />
  <link rel="stylesheet" href="/styles.css" />
  <link
    rel="stylesheet"
    href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
    integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
    crossorigin=""
  />
  <style>
    body{max-width:1100px;margin:0 auto;padding:24px}
    .day-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
    .day-head__meta{margin:6px 0 0;color:#746a60;font-size:14px}
    .day-nav{display:flex;gap:12px;flex-wrap:wrap}
    .day-nav--top{justify-content:flex-end}
    .day-nav--below-media{margin-top:10px;justify-content:flex-end}
    .day-nav a,.back-link{display:inline-block;padding:8px 12px;border-radius:12px;background:#ece7df;color:#2d2823;text-decoration:none}
    .day-section{margin-top:18px;background:#fff;border-radius:16px;padding:16px}
    .day-offer-cta{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px;background:#f7f3ee;border:1px solid rgba(31,26,22,.08)}
    .day-offer-cta p{margin:6px 0 0;color:#5a5248;max-width:700px}
    .day-legal-links{display:flex;flex-wrap:wrap;gap:10px 16px;margin-top:14px}
    .day-legal-links a{color:#1f5f5b;text-decoration:underline;text-underline-offset:2px}
    .media-grid{margin-top:16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
    .media-grid > .media-card{background:#f7f3ee;border-radius:12px;padding:8px;display:flex !important;flex-direction:column !important;align-items:stretch !important;justify-content:flex-start !important;gap:6px;min-height:0;overflow:visible}
    .media-grid > .media-card > a{display:block !important;width:100% !important;flex:0 0 auto !important}
    .media-grid > .media-card > a > img{width:100%;height:180px;object-fit:cover;border-radius:10px;display:block}
    .media-grid > .media-card > .media-card__meta{display:block !important;width:100% !important;font-size:12px;line-height:1.35;color:#5a5248;word-break:break-word;white-space:normal}
    .media-fallback{height:160px;border-radius:10px;background:#ddd}
    .hero-links{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:10px;width:100%}
    .day-modal{position:fixed;inset:0;display:none;z-index:9999}
    .day-modal.is-open{display:block}
    .day-modal__backdrop{position:absolute;inset:0;background:rgba(13,11,10,.7)}
    .day-modal__dialog{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(92vw,980px);max-height:90vh;background:#faf6f1;border-radius:14px;padding:12px;overflow:auto}
    .day-modal__close{position:absolute;right:10px;top:8px;border:0;background:transparent;font-size:34px;line-height:1;cursor:pointer;color:#4a433a}
    .day-modal__nav{position:absolute;top:50%;transform:translateY(-50%);z-index:2;border:0;background:rgba(31,26,22,.66);color:#fffaf2;width:34px;height:44px;border-radius:10px;cursor:pointer;font-size:24px;line-height:1}
    .day-modal__nav--prev{left:10px}
    .day-modal__nav--next{right:10px}
    .day-modal__nav[disabled]{opacity:.35;cursor:not-allowed}
    .day-modal__meta{margin:0 36px 10px 2px;font-size:13px;color:#5a5248}
    .day-modal__body{position:relative}
    .day-modal__body img,.day-modal__body video{display:block;width:100%;max-height:75vh;object-fit:contain;border-radius:10px;background:#111}
    .day-modal__zoom-shell{position:relative;overflow:hidden;border-radius:10px;background:#111;touch-action:none}
    .day-modal__zoom-image{cursor:grab;transform-origin:center center;will-change:transform}
    .day-modal__zoom-image.is-dragging{cursor:grabbing}
    .day-modal__zoom-controls{position:absolute;right:14px;top:50px;z-index:3;display:flex;flex-direction:column;gap:6px}
    .day-modal__zoom-btn{width:32px;height:32px;border-radius:8px;border:1px solid rgba(255,250,242,.78);background:rgba(31,26,22,.72);color:#fffaf2;font-size:20px;line-height:1;cursor:pointer}
    @media (max-width: 720px){.day-modal__dialog{width:95vw;max-height:92vh;padding:10px}}
    .day-comments-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
    .day-comment-btn{border:1px solid rgba(31,26,22,.2);background:#fffaf2;color:#2d2823;border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer}
    .day-comment-btn--media{align-self:flex-end}
    .day-comments-modal{position:fixed;inset:0;display:none;z-index:10000}
    .day-comments-modal.is-open{display:block}
    .day-comments-modal__backdrop{position:absolute;inset:0;background:rgba(13,11,10,.7)}
    .day-comments-modal__dialog{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(92vw,760px);max-height:90vh;overflow:auto;background:#faf6f1;border-radius:14px;padding:14px}
    .day-comments-modal__close{position:absolute;right:10px;top:8px;border:0;background:transparent;font-size:32px;line-height:1;cursor:pointer;color:#4a433a}
    .day-comments-modal__title{margin:2px 38px 10px 2px;font-size:18px}
    .day-comments-list{display:flex;flex-direction:column;gap:10px}
    .day-comment-item{background:#fff;border:1px solid rgba(31,26,22,.08);border-radius:10px;padding:9px 10px}
    .day-comment-meta{font-size:12px;color:#746a60;margin-bottom:4px}
    .day-comment-text{white-space:pre-wrap;line-height:1.4;color:#2d2823}
    .day-comments-form{margin-top:12px;display:flex;flex-direction:column;gap:8px}
    .day-comments-form input,.day-comments-form textarea{width:100%;border:1px solid rgba(31,26,22,.2);border-radius:8px;padding:8px 9px;background:#fffaf2;color:#2d2823}
    .day-comments-form textarea{min-height:84px;resize:vertical}
    .day-comments-form button{align-self:flex-end;border:1px solid rgba(31,26,22,.2);background:#2d2823;color:#fffaf2;border-radius:8px;padding:8px 12px;cursor:pointer}
    .day-comments-state{color:#746a60;font-size:13px}
  </style>
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
  <header class="day-head">
    <div>
      <p><a class="back-link" href="/${lang}/">${ui.backToDiary}</a></p>
      <h1>${escapeHtml(headerTitle)}</h1>
      <p class="day-head__meta">${escapeHtml(headerMeta)}</p>
      <div class="hero-links">
        <a class="back-link" href="${escapeHtml(diaryUrl)}">${ui.openInteractiveDiary}</a>
        <a class="back-link" href="/${lang}/map/">${ui.openMap}</a>
        <nav class="day-nav day-nav--top">${navPrev}${navNext}</nav>
      </div>
    </div>
  </header>
  <section class="day-section">
    <div class="day-comments-head">
      <h2>${ui.dayNotes}</h2>
      <button type="button" class="day-comment-btn" data-comment-target="note-${escapeHtml(commentTargetDate)}">${ui.comments}</button>
    </div>
    ${noteHtml || `<p>${ui.noNotes}</p>`}
  </section>
  ${recommendationsHtml}
  ${dayTrackHtml}
  <section class="day-section">
    <h2>${ui.mediaHeading} (${items.length})</h2>
    <div class="media-grid">
      ${mediaCards || `<p>${ui.noMedia}</p>`}
    </div>
  </section>
  ${(navPrev || navNext) ? `<nav class="day-nav day-nav--below-media">${navPrev}${navNext}</nav>` : ''}
  <section class="day-section day-offer-cta">
    <div>
      <h2>${escapeHtml(ui.offerCtaTitle)}</h2>
      <p>${escapeHtml(ui.offerCtaText)}</p>
      <div class="day-legal-links">
        <a href="/privacy-policy/">Privacy Policy</a>
        <a href="/cookie-policy/">Cookie Policy</a>
        <a href="/termini-e-condizioni/">Termini e condizioni</a>
      </div>
    </div>
    <a class="back-link" href="${escapeHtml(offerPath)}">${escapeHtml(ui.offerCtaLink)}</a>
  </section>
  <div class="day-modal" id="day-media-modal" aria-hidden="true">
    <div class="day-modal__backdrop" id="day-media-backdrop"></div>
    <div class="day-modal__dialog" role="dialog" aria-modal="true" aria-label="Media">
      <button type="button" class="day-modal__close" id="day-media-close" aria-label="${ui.close}">×</button>
      <button type="button" class="day-modal__nav day-modal__nav--prev" id="day-media-prev" aria-label="${ui.prev}">‹</button>
      <button type="button" class="day-modal__nav day-modal__nav--next" id="day-media-next" aria-label="${ui.next}">›</button>
      <div class="day-modal__zoom-controls" id="day-media-zoom-controls">
        <button type="button" class="day-modal__zoom-btn" id="day-media-zoom-out" aria-label="${ui.zoomOut}">−</button>
        <button type="button" class="day-modal__zoom-btn" id="day-media-zoom-in" aria-label="${ui.zoomIn}">+</button>
      </div>
      <p class="day-modal__meta" id="day-media-meta"></p>
      <div class="day-modal__body" id="day-media-body"></div>
    </div>
  </div>
  <div class="day-comments-modal" id="day-comments-modal" aria-hidden="true">
    <div class="day-comments-modal__backdrop" id="day-comments-backdrop"></div>
    <div class="day-comments-modal__dialog" role="dialog" aria-modal="true" aria-label="${ui.comments}">
      <button type="button" class="day-comments-modal__close" id="day-comments-close" aria-label="${ui.close}">×</button>
      <h3 class="day-comments-modal__title" id="day-comments-title">${ui.comments}</h3>
      <div class="day-comments-list" id="day-comments-list"></div>
      <form class="day-comments-form" id="day-comments-form">
        <input id="day-comments-author" type="text" maxlength="80" placeholder="${ui.name}" required />
        <textarea id="day-comments-text" maxlength="1200" placeholder="${ui.writeComment}" required></textarea>
        <button type="submit">${ui.send}</button>
      </form>
    </div>
  </div>
  <script
    src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
    integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="
    crossorigin=""
  ></script>
  <script>window.DAY_PAGE_MAP_DATA = ${dayMapDataJson};</script>
  <script>
    (function () {
      const modal = document.getElementById('day-media-modal');
      const body = document.getElementById('day-media-body');
      const meta = document.getElementById('day-media-meta');
      const closeBtn = document.getElementById('day-media-close');
      const backdrop = document.getElementById('day-media-backdrop');
      const prevBtn = document.getElementById('day-media-prev');
      const nextBtn = document.getElementById('day-media-next');
      const zoomControls = document.getElementById('day-media-zoom-controls');
      const zoomOutBtn = document.getElementById('day-media-zoom-out');
      const zoomInBtn = document.getElementById('day-media-zoom-in');
      if (!modal || !body || !meta || !closeBtn || !backdrop || !prevBtn || !nextBtn || !zoomControls || !zoomOutBtn || !zoomInBtn) return;
      const allLinks = Array.from(document.querySelectorAll('.day-media-link'));
      const linkById = new Map(
        allLinks.map((link) => [String(link.getAttribute('data-media-id') || ''), link])
      );
      let activeLinks = allLinks.slice();
      let activeIndex = -1;
      let zoomCleanup = null;

      const setActiveLinks = (collection) => {
        activeLinks = Array.isArray(collection) && collection.length ? collection : allLinks.slice();
      };

      const attachZoom = (imgEl) => {
        if (!imgEl) return () => {};
        let scale = 1;
        let tx = 0;
        let ty = 0;
        let dragging = false;
        let startX = 0;
        let startY = 0;
        let baseTx = 0;
        let baseTy = 0;

        const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
        const apply = () => {
          imgEl.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
          zoomOutBtn.disabled = scale <= 1.001;
          zoomInBtn.disabled = scale >= 4.999;
        };
        const zoomTo = (next) => {
          scale = clamp(next, 1, 5);
          if (scale <= 1.001) {
            tx = 0;
            ty = 0;
          }
          apply();
        };
        const onWheel = (event) => {
          event.preventDefault();
          const delta = event.deltaY < 0 ? 1.12 : 1 / 1.12;
          zoomTo(scale * delta);
        };
        const onDown = (event) => {
          if (scale <= 1.001) return;
          dragging = true;
          imgEl.classList.add('is-dragging');
          startX = event.clientX;
          startY = event.clientY;
          baseTx = tx;
          baseTy = ty;
        };
        const onMove = (event) => {
          if (!dragging) return;
          event.preventDefault();
          tx = baseTx + (event.clientX - startX);
          ty = baseTy + (event.clientY - startY);
          apply();
        };
        const onUp = () => {
          dragging = false;
          imgEl.classList.remove('is-dragging');
        };
        const onZoomIn = () => zoomTo(scale * 1.2);
        const onZoomOut = () => zoomTo(scale / 1.2);

        imgEl.addEventListener('wheel', onWheel, { passive: false });
        imgEl.addEventListener('mousedown', onDown);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        zoomInBtn.addEventListener('click', onZoomIn);
        zoomOutBtn.addEventListener('click', onZoomOut);
        apply();

        return () => {
          imgEl.removeEventListener('wheel', onWheel);
          imgEl.removeEventListener('mousedown', onDown);
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          zoomInBtn.removeEventListener('click', onZoomIn);
          zoomOutBtn.removeEventListener('click', onZoomOut);
        };
      };

      const openModal = (index, collection = null) => {
        if (collection) setActiveLinks(collection);
        const link = activeLinks[index];
        if (!link) return;
        activeIndex = index;
        const type = link.getAttribute('data-media-type') || 'image';
        const src = link.getAttribute('data-media-src') || '';
        const poster = link.getAttribute('data-media-poster') || '';
        const metaText = link.getAttribute('data-media-meta') || '';
        if (zoomCleanup) {
          zoomCleanup();
          zoomCleanup = null;
        }
        body.innerHTML = '';
        if (type === 'video') {
          const v = document.createElement('video');
          v.controls = true;
          v.autoplay = true;
          v.playsInline = true;
          v.preload = 'metadata';
          v.src = src || '';
          if (poster) v.poster = poster;
          body.appendChild(v);
          zoomControls.style.display = 'none';
        } else {
          const shell = document.createElement('div');
          shell.className = 'day-modal__zoom-shell';
          const img = document.createElement('img');
          img.loading = 'eager';
          img.src = src || '';
          img.alt = metaText || '';
          img.className = 'day-modal__zoom-image';
          shell.appendChild(img);
          body.appendChild(shell);
          zoomControls.style.display = '';
          zoomCleanup = attachZoom(img);
        }
        meta.textContent = metaText || '';
        prevBtn.disabled = activeLinks.length <= 1;
        nextBtn.disabled = activeLinks.length <= 1;
        modal.classList.add('is-open');
        modal.setAttribute('aria-hidden', 'false');
      };

      const openByOffset = (offset) => {
        if (!activeLinks.length) return;
        const base = activeIndex < 0 ? 0 : activeIndex;
        const next = (base + offset + activeLinks.length) % activeLinks.length;
        openModal(next);
      };

      const closeModal = () => {
        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');
        body.innerHTML = '';
        if (zoomCleanup) {
          zoomCleanup();
          zoomCleanup = null;
        }
        setActiveLinks(allLinks);
        activeIndex = -1;
      };

      allLinks.forEach((link, idx) => {
        link.addEventListener('click', (event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button === 1) return;
          event.preventDefault();
          setActiveLinks(allLinks);
          openModal(idx);
        });
      });

      window.dayPageMediaApi = {
        openGroup(ids) {
          const subset = (Array.isArray(ids) ? ids : [])
            .map((id) => linkById.get(String(id || '')))
            .filter(Boolean);
          if (!subset.length) return;
          openModal(0, subset);
        }
      };

      closeBtn.addEventListener('click', closeModal);
      backdrop.addEventListener('click', closeModal);
      prevBtn.addEventListener('click', () => openByOffset(-1));
      nextBtn.addEventListener('click', () => openByOffset(1));
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeModal();
        if (!modal.classList.contains('is-open')) return;
        if (event.key === 'ArrowLeft') openByOffset(-1);
        if (event.key === 'ArrowRight') openByOffset(1);
      });

      const commentsModal = document.getElementById('day-comments-modal');
      const commentsBackdrop = document.getElementById('day-comments-backdrop');
      const commentsClose = document.getElementById('day-comments-close');
      const commentsTitle = document.getElementById('day-comments-title');
      const commentsList = document.getElementById('day-comments-list');
      const commentsForm = document.getElementById('day-comments-form');
      const commentsAuthor = document.getElementById('day-comments-author');
      const commentsText = document.getElementById('day-comments-text');
      const AUTHOR_KEY = 'cammino_comment_author_v1';
      let activeCommentTarget = '';

      const escapeHtml = (value) => String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');

      const renderComments = (items, stateText) => {
        if (!commentsList) return;
        if (stateText) {
          commentsList.innerHTML = '<div class="day-comments-state">' + escapeHtml(stateText) + '</div>';
          return;
        }
        const arr = Array.isArray(items) ? items : [];
        if (!arr.length) {
          commentsList.innerHTML = '<div class="day-comments-state">${escapeHtml(ui.commentsEmpty)}</div>';
          return;
        }
        commentsList.innerHTML = arr.map((c) => (
          '<article class="day-comment-item">' +
            '<div class="day-comment-meta">' + escapeHtml(c.author || '') + ' · ' + escapeHtml(String(c.created_at || '').replace('T', ' ').slice(0, 16)) + '</div>' +
            '<div class="day-comment-text">' + escapeHtml(c.text || '') + '</div>' +
          '</article>'
        )).join('');
      };

      const openComments = async (target) => {
        activeCommentTarget = String(target || '').trim();
        if (!activeCommentTarget) return;
        if (commentsTitle) commentsTitle.textContent = activeCommentTarget.startsWith('note-')
          ? '${escapeHtml(ui.commentsOnDay)}'
          : '${escapeHtml(ui.commentsOnMedia)}';
        if (commentsAuthor && !commentsAuthor.value) {
          try { commentsAuthor.value = localStorage.getItem(AUTHOR_KEY) || ''; } catch {}
        }
        renderComments([], '${escapeHtml(ui.commentsLoading)}');
        commentsModal.classList.add('is-open');
        commentsModal.setAttribute('aria-hidden', 'false');
        try {
          const res = await fetch('/api/comments?target=' + encodeURIComponent(activeCommentTarget), { cache: 'no-store' });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const payload = await res.json();
          renderComments(payload && payload.comments ? payload.comments : []);
        } catch (err) {
          renderComments([], '${escapeHtml(ui.commentsLoadError)}');
        }
      };

      const closeComments = () => {
        commentsModal.classList.remove('is-open');
        commentsModal.setAttribute('aria-hidden', 'true');
        activeCommentTarget = '';
      };

      document.querySelectorAll('[data-comment-target]').forEach((btn) => {
        btn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          openComments(btn.getAttribute('data-comment-target'));
        });
      });

      if (commentsBackdrop) commentsBackdrop.addEventListener('click', closeComments);
      if (commentsClose) commentsClose.addEventListener('click', closeComments);
      if (commentsForm) {
        commentsForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          if (!activeCommentTarget) return;
          const author = String((commentsAuthor && commentsAuthor.value) || '').trim();
          const text = String((commentsText && commentsText.value) || '').trim();
          if (!author || !text) return;
          try { localStorage.setItem(AUTHOR_KEY, author); } catch {}
          const submitBtn = commentsForm.querySelector('button[type="submit"]');
          if (submitBtn) submitBtn.disabled = true;
          try {
            const res = await fetch('/api/comments', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ target: activeCommentTarget, author, text })
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            if (commentsText) commentsText.value = '';
            await openComments(activeCommentTarget);
          } catch (err) {
            renderComments([], '${escapeHtml(ui.commentsSaveError)}');
          } finally {
            if (submitBtn) submitBtn.disabled = false;
          }
        });
      }
    })();
  </script>
  <script src="/day-page-map.js"></script>
</body>
</html>`;
}

async function buildSitemapXmlForOrigin(origin) {
  const itEntries = await readEntriesByLang('it');
  const days = Array.isArray(itEntries && itEntries.days) ? itEntries.days : [];
  const PROLOGUE_DATES = new Set(['2019-06-02', '2019-06-03']);
  const urls = [];
  const langs = ['it', 'en', 'es', 'fr'];
  const isImagePath = (value) => {
    const pathValue = String(value || '').trim().toLowerCase();
    return /\.(jpg|jpeg|png|webp|gif|heic|heif)(\?.*)?$/.test(pathValue);
  };
  const asSitePath = (value) => {
    const clean = String(value || '').trim();
    if (!clean) return '';
    return clean.startsWith('/') ? clean : `/${clean.replace(/^\.?\//, '')}`;
  };
  const pickImagesForDay = (day) => {
    const byLoc = new Map();
    const items = Array.isArray(day && day.items) ? day.items : [];
    items.forEach((item) => {
      const candidates = [item && item.thumb, item && item.poster, item && item.src].map(asSitePath).filter(Boolean);
      candidates.forEach((candidate) => {
        if (!isImagePath(candidate)) return;
        const loc = buildAbsoluteUrl(origin, candidate);
        if (byLoc.has(loc)) return;
        const mediaType = String(item && item.type ? item.type : '').toLowerCase() === 'video' ? 'Video' : 'Foto';
        const date = String(day && day.date ? day.date : '').trim();
        const time = String(item && item.time ? item.time : '').trim();
        const orig = String(item && item.orig ? item.orig : '').trim();
        const title = `Cammino di Santiago · ${date} · ${mediaType}`;
        const captionBase = orig || `${mediaType} del ${date}`;
        const caption = time ? `${date} ${time} · ${captionBase}` : `${date} · ${captionBase}`;
        byLoc.set(loc, { loc, title, caption });
      });
    });
    return Array.from(byLoc.values());
  };
  const push = (locPath, lastmod = null, priority = null, changefreq = null, images = [], alternates = null) => {
    const tags = [`<loc>${escapeHtml(buildAbsoluteUrl(origin, locPath))}</loc>`];
    if (lastmod) tags.push(`<lastmod>${escapeHtml(lastmod)}</lastmod>`);
    if (changefreq) tags.push(`<changefreq>${escapeHtml(changefreq)}</changefreq>`);
    if (priority) tags.push(`<priority>${escapeHtml(priority)}</priority>`);
    if (alternates && typeof alternates === 'object') {
      langs.forEach((lang) => {
        const hrefPath = alternates[lang];
        if (!hrefPath) return;
        tags.push(`<xhtml:link rel="alternate" hreflang="${lang}" href="${escapeHtml(buildAbsoluteUrl(origin, hrefPath))}" />`);
      });
      if (alternates.it) {
        tags.push(`<xhtml:link rel="alternate" hreflang="x-default" href="${escapeHtml(buildAbsoluteUrl(origin, alternates.it))}" />`);
      }
    }
    if (Array.isArray(images) && images.length) {
      images.forEach((img) => {
        if (!img || !img.loc) return;
        const imageTags = [`<image:loc>${escapeHtml(img.loc)}</image:loc>`];
        if (img.title) imageTags.push(`<image:title>${escapeHtml(img.title)}</image:title>`);
        if (img.caption) imageTags.push(`<image:caption>${escapeHtml(img.caption)}</image:caption>`);
        tags.push(`<image:image>${imageTags.join('')}</image:image>`);
      });
    }
    urls.push(`<url>${tags.join('')}</url>`);
  };
  const generatedDate = itEntries && itEntries.generated_at ? String(itEntries.generated_at).slice(0, 10) : null;
  const homeAlt = { it: '/it/', en: '/en/', es: '/es/', fr: '/fr/' };
  const mapAlt = { it: '/it/map/', en: '/en/map/', es: '/es/map/', fr: '/fr/map/' };
  const peopleAlt = { it: '/it/people/', en: '/en/people/', es: '/es/people/', fr: '/fr/people/' };
  const contactAlt = { it: '/it/contatti/', en: '/en/contatti/', es: '/es/contatti/', fr: '/fr/contatti/' };
  const freeGuideAlt = { ...FREE_GUIDE_PATH_BY_LANG };
  const offerAlt = {
    it: '/it/crea-il-tuo-diario/',
    en: '/en/crea-il-tuo-diario/',
    es: '/es/crea-il-tuo-diario/',
    fr: '/fr/crea-il-tuo-diario/'
  };
  push('/privacy-policy/', generatedDate, '0.2', 'yearly');
  push('/cookie-policy/', generatedDate, '0.2', 'yearly');
  push('/termini-e-condizioni/', generatedDate, '0.3', 'yearly');
  push('/it/', generatedDate, '1.0', 'daily', [], homeAlt);
  push('/en/', generatedDate, '0.9', 'daily', [], homeAlt);
  push('/es/', generatedDate, '0.9', 'daily', [], homeAlt);
  push('/fr/', generatedDate, '0.9', 'daily', [], homeAlt);
  push('/it/map/', null, '0.8', 'weekly', [], mapAlt);
  push('/en/map/', null, '0.8', 'weekly', [], mapAlt);
  push('/es/map/', null, '0.8', 'weekly', [], mapAlt);
  push('/fr/map/', null, '0.8', 'weekly', [], mapAlt);
  push('/it/people/', null, '0.7', 'weekly', [], peopleAlt);
  push('/en/people/', null, '0.7', 'weekly', [], peopleAlt);
  push('/es/people/', null, '0.7', 'weekly', [], peopleAlt);
  push('/fr/people/', null, '0.7', 'weekly', [], peopleAlt);
  push('/it/contatti/', null, '0.5', 'monthly', [], contactAlt);
  push('/en/contatti/', null, '0.5', 'monthly', [], contactAlt);
  push('/es/contatti/', null, '0.5', 'monthly', [], contactAlt);
  push('/fr/contatti/', null, '0.5', 'monthly', [], contactAlt);
  push(FREE_GUIDE_PATH_BY_LANG.it, generatedDate, '0.7', 'monthly', [], freeGuideAlt);
  push(FREE_GUIDE_PATH_BY_LANG.en, generatedDate, '0.7', 'monthly', [], freeGuideAlt);
  push(FREE_GUIDE_PATH_BY_LANG.es, generatedDate, '0.6', 'monthly', [], freeGuideAlt);
  push(FREE_GUIDE_PATH_BY_LANG.fr, generatedDate, '0.6', 'monthly', [], freeGuideAlt);
  push('/it/crea-il-tuo-diario/', generatedDate, '0.6', 'monthly', [], offerAlt);
  push('/en/crea-il-tuo-diario/', generatedDate, '0.6', 'monthly', [], offerAlt);
  push('/es/crea-il-tuo-diario/', generatedDate, '0.6', 'monthly', [], offerAlt);
  push('/fr/crea-il-tuo-diario/', generatedDate, '0.6', 'monthly', [], offerAlt);
  const prologueDays = days.filter((day) => PROLOGUE_DATES.has(String(day && day.date ? day.date : '').trim()));
  if (prologueDays.length) {
    const byLoc = new Map();
    prologueDays.forEach((day) => {
      pickImagesForDay(day).forEach((img) => {
        if (img && img.loc && !byLoc.has(img.loc)) byLoc.set(img.loc, img);
      });
    });
    const prologueImages = Array.from(byLoc.values());
    const prologueLastmod = prologueDays
      .map((day) => String(day && day.date ? day.date : '').trim())
      .filter(Boolean)
      .sort()
      .slice(-1)[0] || null;
    const prologueAlt = {
      it: '/it/prologue/',
      en: '/en/prologue/',
      es: '/es/prologue/',
      fr: '/fr/prologue/'
    };
    push('/it/prologue/', prologueLastmod, '0.7', 'monthly', prologueImages, prologueAlt);
    push('/en/prologue/', prologueLastmod, '0.7', 'monthly', prologueImages, prologueAlt);
    push('/es/prologue/', prologueLastmod, '0.7', 'monthly', prologueImages, prologueAlt);
    push('/fr/prologue/', prologueLastmod, '0.7', 'monthly', prologueImages, prologueAlt);
  }
  for (const day of days) {
    const date = String(day && day.date ? day.date : '').trim();
    if (!date) continue;
    if (PROLOGUE_DATES.has(date)) continue;
    const images = pickImagesForDay(day);
    const dayAlt = {
      it: `/it/day/${date}/`,
      en: `/en/day/${date}/`,
      es: `/es/day/${date}/`,
      fr: `/fr/day/${date}/`
    };
    push(`/it/day/${date}/`, date, '0.7', 'monthly', images, dayAlt);
    push(`/en/day/${date}/`, date, '0.7', 'monthly', images, dayAlt);
    push(`/es/day/${date}/`, date, '0.7', 'monthly', images, dayAlt);
    push(`/fr/day/${date}/`, date, '0.7', 'monthly', images, dayAlt);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
}

async function buildSitemapXml(req) {
  return buildSitemapXmlForOrigin(getRequestOrigin(req));
}

async function generateStaticDayPages({ outputRoot, origin }) {
  const targetRoot = path.resolve(String(outputRoot || '').trim() || ROOT);
  const siteOrigin = String(origin || '').trim().replace(/\/+$/, '') || 'https://mycamino.it';
  const langs = ['it', 'en', 'es', 'fr'];
  const dayOgOverrides = await readDayOgOverrides();
  for (const lang of langs) {
    const entries = await readEntriesByLang(lang);
    const days = Array.isArray(entries && entries.days) ? entries.days : [];
    for (let index = 0; index < days.length; index += 1) {
      const day = days[index];
      const date = String(day && day.date ? day.date : '').trim();
      if (!date) continue;
      const prevDay = index > 0 ? days[index - 1] : null;
      const nextDay = index < days.length - 1 ? days[index + 1] : null;
      const dayNumber = index + 1;
      const trackDayKey = String(day && day.trackDate ? day.trackDate : date).slice(0, 10);
      const dayMapData = await buildCanonicalDayMapData(days, lang, trackDayKey, day && day.items);
      const html = buildDayPageHtml({
        origin: siteOrigin,
        lang,
        day,
        prevDay,
        nextDay,
        dayOgOverrides,
        options: {
          dayMapData,
          trackDayKey,
          dayNumber,
          prevLabel: prevDay ? buildDayLabel(lang, index) : '',
          nextLabel: nextDay ? buildDayLabel(lang, index + 2) : ''
        }
      });
      const dayDir = path.join(targetRoot, lang, 'day', date);
      await fs.mkdir(dayDir, { recursive: true });
      await fs.writeFile(path.join(dayDir, 'index.html'), html, 'utf8');
    }
  }
}

function getRequestProto(req) {
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
}

function getRequestHostHeader(req) {
  return String(req.headers['x-canonical-host'] || req.headers.host || req.headers['x-forwarded-host'] || '').split(',')[0].trim();
}

function normalizeHostName(hostValue) {
  return String(hostValue || '').trim().toLowerCase().replace(/:\d+$/, '');
}

function isLocalHostName(hostName) {
  return hostName === 'localhost' || hostName === '127.0.0.1' || hostName === '[::1]' || hostName.endsWith('.local');
}

function shouldRedirectToPrimaryHost(hostName) {
  if (!hostName || !PRIMARY_SITE_HOST) return false;
  if (hostName === PRIMARY_SITE_HOST) return false;
  if (isLocalHostName(hostName)) return false;
  if (LEGACY_SITE_HOSTS.size > 0) return LEGACY_SITE_HOSTS.has(hostName);
  return true;
}

function getRequestOrigin(req) {
  const protoHeader = getRequestProto(req);
  const hostHeader = getRequestHostHeader(req);
  const proto = protoHeader || (ADMIN_COOKIE_SECURE ? 'https' : 'http');
  const host = hostHeader || `${HOST}:${PORT}`;
  return `${proto}://${host}`;
}

function parseLocaleFromPath(pathname) {
  const pathValue = String(pathname || '/');
  const match = pathValue.match(/^\/(it|en|es|fr)(\/|$)/i);
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
  const reqUrl = new URL(String(req && req.url ? req.url : '/'), origin);
  const isPrologue = PROLOGUE_PAGE_PATH_RE.test(String(reqUrl.pathname || ''));
  const canonicalPath = isPrologue ? `/${lang}/prologue/` : `/${lang}/`;
  const canonical = `${origin}${canonicalPath}`;
  const altIt = `${origin}${isPrologue ? '/it/prologue/' : '/it/'}`;
  const altEn = `${origin}${isPrologue ? '/en/prologue/' : '/en/'}`;
  const altEs = `${origin}${isPrologue ? '/es/prologue/' : '/es/'}`;
  const altFr = `${origin}${isPrologue ? '/fr/prologue/' : '/fr/'}`;
  const ogImage = `${origin}/assets/og-image.jpg`;
  const robotsContent = 'noindex,follow,max-image-preview:large';

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
  out = out.replace(/(<link[^>]*id="seo-alt-es"[^>]*href=")[^"]*(")/i, `$1${escapeHtml(altEs)}$2`);
  out = out.replace(/(<link[^>]*id="seo-alt-fr"[^>]*href=")[^"]*(")/i, `$1${escapeHtml(altFr)}$2`);
  out = out.replace(
    /(<link[^>]*id="seo-alt-default"[^>]*href=")[^"]*(")/i,
    `$1${escapeHtml(altIt)}$2`
  );
  const metaRobots = `<meta name="robots" content="${escapeHtml(robotsContent)}" />`;
  if (!/<meta[^>]*name="robots"/i.test(out)) {
    out = out.replace('</head>', `  ${metaRobots}\n</head>`);
  }
  const ogTitle = isPrologue ? `${seo.title} | Prologue` : seo.title;
  const ogDescription = isPrologue ? seo.description : seo.description;
  const ogTags = [
    '<meta property="og:type" content="website" />',
    `<meta property="og:title" content="${escapeHtml(ogTitle)}" />`,
    `<meta property="og:description" content="${escapeHtml(ogDescription)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    `<meta property="og:image" content="${escapeHtml(ogImage)}" />`,
    `<meta property="og:image:width" content="${OG_IMAGE_WIDTH}" />`,
    `<meta property="og:image:height" content="${OG_IMAGE_HEIGHT}" />`,
    `<meta property="og:image:type" content="${OG_IMAGE_TYPE}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${escapeHtml(ogTitle)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(ogDescription)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(ogImage)}" />`
  ];
  out = out.replace('</head>', `  ${ogTags.join('\n  ')}\n</head>`);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: ogTitle,
    description: ogDescription,
    inLanguage: lang,
    url: canonical,
    author: {
      '@type': 'Person',
      name: SITE_AUTHOR
    }
  };
  out = out.replace('</head>', `  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>\n</head>`);
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

async function readUiFlags() {
  const raw = await readJson(UI_FLAGS_PATH, defaultUiFlags());
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultUiFlags();
  return {
    show_footer_template_cta: raw.show_footer_template_cta !== false
  };
}

async function writeUiFlags(flags) {
  const normalized = {
    show_footer_template_cta: !!(flags && flags.show_footer_template_cta !== false)
  };
  await writeJson(UI_FLAGS_PATH, normalized);
  return normalized;
}

async function readAdminAuthStore() {
  const raw = await readJson(ADMIN_AUTH_PATH, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw;
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

function buildAdminPasswordHash(secret) {
  const iterations = 120000;
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.pbkdf2Sync(String(secret), salt, iterations, 32, 'sha256').toString('hex');
  return `pbkdf2_sha256:${iterations}:${salt}:${derived}`;
}

function verifyAdminPasswordHash(secret, storedHash) {
  const raw = String(storedHash || '').trim();
  if (!raw) return false;
  if (!raw.startsWith('pbkdf2_sha256:')) return false;
  const parts = raw.split(':');
  if (parts.length !== 4) return false;
  const iterations = Math.max(1, Number(parts[1] || 0));
  const salt = String(parts[2] || '');
  const expected = String(parts[3] || '');
  if (!iterations || !salt || !expected) return false;
  const derived = crypto.pbkdf2Sync(String(secret), salt, iterations, 32, 'sha256').toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(derived, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
}

async function verifyAdminSecret(secret) {
  const value = String(secret || '').trim();
  if (!value) return false;
  const store = await readAdminAuthStore();
  const passwordHash = String(store && store.password_hash ? store.password_hash : '').trim();
  if (passwordHash) return verifyAdminPasswordHash(value, passwordHash);
  return isValidAdminToken(value);
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

async function ensureAdmin(req, res, urlObj) {
  if (hasValidAdminSession(req)) return true;
  const token = getAdminTokenFromRequest(req, urlObj);
  if (!(await verifyAdminSecret(token))) {
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
    if (!(await verifyAdminSecret(token))) {
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

async function handleAdminGetSettings(req, res) {
  try {
    const urlObj = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    if (!(await ensureAdmin(req, res, urlObj))) return;
    const settings = await readUiFlags();
    sendJson(res, 200, { settings });
  } catch (err) {
    sendJson(res, 500, { error: err.message || String(err) });
  }
}

async function handleAdminSaveSettings(req, res) {
  try {
    const urlObj = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    if (!(await ensureAdmin(req, res, urlObj))) return;
    const payload = await parseJsonBody(req, 64 * 1024);
    const incoming = payload && payload.settings && typeof payload.settings === 'object' && !Array.isArray(payload.settings)
      ? payload.settings
      : payload;
    const settings = await writeUiFlags(incoming || {});
    sendJson(res, 200, { ok: true, settings });
  } catch (err) {
    sendJson(res, 500, { error: err.message || String(err) });
  }
}

async function handlePublicSettings(req, res) {
  try {
    const settings = await readUiFlags();
    sendJson(res, 200, { settings });
  } catch (err) {
    sendJson(res, 500, { error: err.message || String(err) });
  }
}

async function handleAdminChangePassword(req, res) {
  try {
    const urlObj = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    if (!(await ensureAdmin(req, res, urlObj))) return;
    const payload = await parseJsonBody(req, 64 * 1024);
    const currentPassword = String(payload && payload.current_password ? payload.current_password : '').trim();
    const newPassword = String(payload && payload.new_password ? payload.new_password : '').trim();
    if (!(await verifyAdminSecret(currentPassword))) {
      sendJson(res, 401, { ok: false, error: 'Password attuale non valida' });
      return;
    }
    if (newPassword.length < 8) {
      sendJson(res, 422, { ok: false, error: 'La nuova password deve avere almeno 8 caratteri' });
      return;
    }
    if (newPassword.length > 200) {
      sendJson(res, 422, { ok: false, error: 'La nuova password e troppo lunga' });
      return;
    }
    await writeJson(ADMIN_AUTH_PATH, {
      password_hash: buildAdminPasswordHash(newPassword),
      updated_at: new Date().toISOString()
    });
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message || String(err) });
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
    const counts = {};
    const store = await readCommentsStore();
    if (targets.length) {
      const wanted = new Set(targets);
      targets.forEach((t) => {
        counts[t] = 0;
      });
      for (const comment of store.comments) {
        const target = String(comment.target || '');
        if (!wanted.has(target)) continue;
        counts[target] = (counts[target] || 0) + 1;
      }
    } else {
      for (const comment of store.comments) {
        const target = normalizeCommentTarget(comment && comment.target);
        if (!target) continue;
        counts[target] = (counts[target] || 0) + 1;
      }
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
    if (!(await ensureAdmin(req, res, urlObj))) return;
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
    if (!(await ensureAdmin(req, res, urlObj))) return;
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

async function handleAdminGetDayOgOverrides(req, res) {
  try {
    const urlObj = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    if (!(await ensureAdmin(req, res, urlObj))) return;
    const overrides = await readDayOgOverrides();
    sendJson(res, 200, { overrides });
  } catch (err) {
    sendJson(res, 500, { error: err.message || String(err) });
  }
}

async function handleAdminSaveDayOgOverrides(req, res) {
  try {
    const urlObj = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    if (!(await ensureAdmin(req, res, urlObj))) return;
    const payload = await parseJsonBody(req, 256 * 1024);
    let overrides = {};
    if (payload && payload.overrides && typeof payload.overrides === 'object' && !Array.isArray(payload.overrides)) {
      overrides = payload.overrides;
    } else if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      overrides = payload;
    }
    const normalized = normalizeDayOgOverrides(overrides);
    await writeDayOgOverrides(normalized);
    sendJson(res, 200, { ok: true, overrides: normalized });
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
  if (!(await ensureAdmin(req, res, urlObj))) return;
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
    const rebuiltTrackGeo = rebuildTrackGeoJson(filteredTrackPoints);

    for (const lang of ENTRY_LANGS) {
      await writeEntriesByLang(lang, updatedEntriesByLang[lang]);
    }
    await writeJson(trackPointsPath, filteredTrackPoints);
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
  const requested = requestPath || req.url || '/';
  let fsPath = toFsPath(requested);
  if (!fsPath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  let stat;
  try {
    stat = await fs.stat(fsPath);
  } catch {
    const fallbacks = buildStaticFallbackCandidates(requested);
    let resolvedFallback = null;
    for (const candidate of fallbacks) {
      const candidatePath = toFsPath(candidate);
      if (!candidatePath) continue;
      try {
        const s = await fs.stat(candidatePath);
        resolvedFallback = { path: candidatePath, stat: s };
        break;
      } catch {
        // continue
      }
    }
    if (!resolvedFallback) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    fsPath = resolvedFallback.path;
    stat = resolvedFallback.stat;
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

  if (ext === '.html' && finalPath === path.join(ROOT, 'map.html') && locale) {
    try {
      const raw = await fs.readFile(finalPath, 'utf8');
      const html = localizeMapHtml(raw, locale, req);
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

  if (ext === '.html' && finalPath === path.join(ROOT, 'people.html') && locale) {
    try {
      const raw = await fs.readFile(finalPath, 'utf8');
      const html = localizePeopleHtml(raw, locale, req);
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

async function serveDayPage(req, res, lang, date) {
  try {
    const entries = await readEntriesByLang(lang);
    const dayOgOverrides = await readDayOgOverrides();
    const days = Array.isArray(entries && entries.days) ? entries.days : [];
    const index = days.findIndex((day) => String(day && day.date ? day.date : '') === date);
    if (index < 0) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const day = days[index];
    const prevDay = index > 0 ? days[index - 1] : null;
    const nextDay = index < days.length - 1 ? days[index + 1] : null;
    const dayNumber = index + 1;
    const trackDayKey = String(day && day.trackDate ? day.trackDate : date).slice(0, 10);
    const dayMapData = await buildCanonicalDayMapData(days, lang, trackDayKey, day && day.items);
    const html = buildDayPageHtml({
      origin: getRequestOrigin(req),
      lang,
      day,
      prevDay,
      nextDay,
      dayOgOverrides,
      options: {
        dayMapData,
        trackDayKey,
        dayNumber,
        prevLabel: prevDay ? buildDayLabel(lang, index) : '',
        nextLabel: nextDay ? buildDayLabel(lang, index + 2) : ''
      }
    });
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache'
    });
    res.end(html);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(err && err.message ? err.message : 'Server error');
  }
}

async function serveProloguePage(req, res, lang) {
  try {
    const entries = await readEntriesByLang(lang);
    const dayOgOverrides = await readDayOgOverrides();
    const days = Array.isArray(entries && entries.days) ? entries.days : [];
    const mergedDay = mergePrologueDay(days, lang);
    if (!mergedDay) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const nextDay = days.find((day) => !PROLOGUE_DATES.includes(String(day && day.date ? day.date : '').slice(0, 10))) || null;
    const prologueLabelByLang = {
      it: 'Prologo · 2–3 giugno',
      en: 'Prologue · June 2–3',
      es: 'Prólogo · 2–3 de junio',
      fr: 'Prologue · 2–3 juin'
    };
    const prologueSeoPrefixByLang = {
      it: 'Prologo',
      en: 'Prologue',
      es: 'Prólogo',
      fr: 'Prologue'
    };
    const displayLabel = prologueLabelByLang[lang] || prologueLabelByLang.it;
    const seoPrefix = prologueSeoPrefixByLang[lang] || prologueSeoPrefixByLang.it;
    const nextDayNumber = nextDay
      ? (days.findIndex((day) => String(day && day.date ? day.date : '').slice(0, 10) === String(nextDay && nextDay.date ? nextDay.date : '').slice(0, 10)) + 1)
      : 0;
    const html = buildDayPageHtml({
      origin: getRequestOrigin(req),
      lang,
      day: mergedDay,
      prevDay: null,
      nextDay,
      dayOgOverrides,
      options: {
        canonicalPath: `/${lang}/prologue/`,
        altPaths: {
          it: '/it/prologue/',
          en: '/en/prologue/',
          es: '/es/prologue/',
          fr: '/fr/prologue/'
        },
        diaryPath: `/${lang}/?day=prologue`,
        interactiveMediaBase: `/${lang}/?day=prologue&target=`,
        commentTargetDate: PROLOGUE_TRACK_DATE,
        showTrackCard: false,
        stageLabel: seoPrefix,
        displayDate: displayLabel,
        prevHref: null,
        nextLabel: nextDayNumber > 0 ? buildDayLabel(lang, nextDayNumber) : ''
      }
    });
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache'
    });
    res.end(html);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(err && err.message ? err.message : 'Server error');
  }
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  const requestHostHeader = getRequestHostHeader(req);
  const requestHostName = normalizeHostName(requestHostHeader);
  if (shouldRedirectToPrimaryHost(requestHostName)) {
    const targetUrl = `https://${PRIMARY_SITE_HOST}${req.url || '/'}`;
    res.writeHead(req.method === 'GET' || req.method === 'HEAD' ? 301 : 308, {
      Location: targetUrl,
      'Cache-Control': 'public, max-age=3600'
    });
    res.end();
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
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/admin/password') {
    await handleAdminChangePassword(req, res);
    return;
  }
  if (req.method === 'GET' && req.url.split('?')[0] === '/api/admin/settings') {
    await handleAdminGetSettings(req, res);
    return;
  }
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/admin/settings') {
    await handleAdminSaveSettings(req, res);
    return;
  }
  if (req.method === 'GET' && req.url.split('?')[0] === '/api/public/settings') {
    await handlePublicSettings(req, res);
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
  if (req.method === 'GET' && req.url.split('?')[0] === '/api/admin/day-og-overrides') {
    await handleAdminGetDayOgOverrides(req, res);
    return;
  }
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/admin/day-og-overrides') {
    await handleAdminSaveDayOgOverrides(req, res);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end('Method not allowed');
    return;
  }

  const urlObj = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  if (urlObj.pathname === '/robots.txt') {
    const origin = getRequestOrigin(req);
    const body = `User-agent: *\nAllow: /\nSitemap: ${buildAbsoluteUrl(origin, '/sitemap.xml')}\n`;
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache'
    });
    res.end(body);
    return;
  }
  if (urlObj.pathname === '/sitemap.xml') {
    try {
      const xml = await buildSitemapXml(req);
      res.writeHead(200, {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'no-cache'
      });
      res.end(xml);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(err && err.message ? err.message : 'Server error');
    }
    return;
  }
  if (urlObj.pathname === '/') {
    const target = `/it/${urlObj.search || ''}`;
    res.writeHead(302, { Location: target });
    res.end();
    return;
  }

  if (urlObj.pathname === '/people' || urlObj.pathname === '/people.html') {
    res.writeHead(301, { Location: `/it/people/${urlObj.search || ''}` });
    res.end();
    return;
  }

  if (urlObj.pathname === '/prologue' || urlObj.pathname === '/prologue.html') {
    res.writeHead(301, { Location: `/it/prologue/${urlObj.search || ''}` });
    res.end();
    return;
  }

  const dayMatch = urlObj.pathname.match(DAY_PAGE_PATH_RE);
  if (dayMatch) {
    const lang = String(dayMatch[1]).toLowerCase();
    const date = String(dayMatch[2]);
    if (urlObj.pathname !== `/${lang}/day/${date}/`) {
      res.writeHead(301, { Location: `/${lang}/day/${date}/${urlObj.search || ''}` });
      res.end();
      return;
    }
    await serveDayPage(req, res, lang, date);
    return;
  }

  const prologueMatch = urlObj.pathname.match(PROLOGUE_PAGE_PATH_RE);
  if (prologueMatch) {
    const lang = String(prologueMatch[1]).toLowerCase();
    if (urlObj.pathname !== `/${lang}/prologue/`) {
      res.writeHead(301, { Location: `/${lang}/prologue/${urlObj.search || ''}` });
      res.end();
      return;
    }
    await serveProloguePage(req, res, lang);
    return;
  }

  const mapMatch = urlObj.pathname.match(MAP_PAGE_PATH_RE);
  if (mapMatch) {
    const lang = String(mapMatch[1]).toLowerCase();
    await serveStatic(req, res, `/map.html${urlObj.search || ''}`, lang);
    return;
  }

  const peopleMatch = urlObj.pathname.match(PEOPLE_PAGE_PATH_RE);
  if (peopleMatch) {
    const lang = String(peopleMatch[1]).toLowerCase();
    if (urlObj.pathname !== `/${lang}/people/`) {
      res.writeHead(301, { Location: `/${lang}/people/${urlObj.search || ''}` });
      res.end();
      return;
    }
    await serveStatic(req, res, `/people.html${urlObj.search || ''}`, lang);
    return;
  }

  const contactMatch = urlObj.pathname.match(CONTACT_PAGE_PATH_RE);
  if (contactMatch) {
    const lang = String(contactMatch[1]).toLowerCase();
    if (urlObj.pathname !== `/${lang}/contatti/`) {
      res.writeHead(301, { Location: `/${lang}/contatti/${urlObj.search || ''}` });
      res.end();
      return;
    }
    await serveStatic(req, res, `/contatti.html${urlObj.search || ''}`, lang);
    return;
  }

  const freeGuideLang = matchLocalizedStaticPath(urlObj.pathname, FREE_GUIDE_PATH_BY_LANG);
  if (freeGuideLang) {
    const canonicalPath = FREE_GUIDE_PATH_BY_LANG[freeGuideLang];
    if (urlObj.pathname !== canonicalPath) {
      res.writeHead(301, { Location: `${canonicalPath}${urlObj.search || ''}` });
      res.end();
      return;
    }
    await serveStatic(req, res, `/guida-gratuita.html${urlObj.search || ''}`, freeGuideLang);
    return;
  }

  const offerMatch = urlObj.pathname.match(OFFER_PAGE_PATH_RE);
  if (offerMatch) {
    const lang = String(offerMatch[1]).toLowerCase();
    if (urlObj.pathname !== `/${lang}/crea-il-tuo-diario/`) {
      res.writeHead(301, { Location: `/${lang}/crea-il-tuo-diario/${urlObj.search || ''}` });
      res.end();
      return;
    }
    await serveStatic(req, res, `/crea-il-tuo-diario.html${urlObj.search || ''}`, lang);
    return;
  }

  if (PRIVACY_PAGE_PATH_RE.test(urlObj.pathname)) {
    if (urlObj.pathname !== '/privacy-policy/') {
      res.writeHead(301, { Location: `/privacy-policy/${urlObj.search || ''}` });
      res.end();
      return;
    }
    await serveStatic(req, res, `/privacy-policy.html${urlObj.search || ''}`);
    return;
  }

  if (COOKIE_POLICY_PATH_RE.test(urlObj.pathname)) {
    if (urlObj.pathname !== '/cookie-policy/') {
      res.writeHead(301, { Location: `/cookie-policy/${urlObj.search || ''}` });
      res.end();
      return;
    }
    await serveStatic(req, res, `/cookie-policy.html${urlObj.search || ''}`);
    return;
  }

  if (TERMS_PAGE_PATH_RE.test(urlObj.pathname)) {
    if (urlObj.pathname !== '/termini-e-condizioni/') {
      res.writeHead(301, { Location: `/termini-e-condizioni/${urlObj.search || ''}` });
      res.end();
      return;
    }
    await serveStatic(req, res, `/termini-e-condizioni.html${urlObj.search || ''}`);
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

module.exports = {
  buildDayPageHtml,
  buildSitemapXmlForOrigin,
  generateStaticDayPages,
  readDayOgOverrides,
  readEntriesByLang
};

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
  });
}

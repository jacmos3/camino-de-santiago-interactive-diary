const http = require('http');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { createReadStream } = require('fs');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname);
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
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
const DAY_PAGE_PATH_RE = /^\/(it|en|es|fr)\/day\/(\d{4}-\d{2}-\d{2})\/?$/i;
const MAP_PAGE_PATH_RE = /^\/(it|en|es|fr)\/map\/?$/i;
const PEOPLE_PAGE_PATH_RE = /^\/(it|en|es|fr)\/people\/?$/i;
const CONTACT_PAGE_PATH_RE = /^\/(it|en|es|fr)\/contatti\/?$/i;

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

function buildAbsoluteUrl(origin, pathValue) {
  const base = String(origin || '').replace(/\/+$/, '');
  const pathPart = String(pathValue || '/').startsWith('/') ? String(pathValue || '/') : `/${String(pathValue || '/')}`;
  return `${base}${pathPart}`;
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

function normalizeImageCandidate(item) {
  if (!item || typeof item !== 'object') return '';
  const thumb = mediaPath(item, 'thumb');
  const src = mediaPath(item, 'src');
  const poster = mediaPath(item, 'poster');
  return thumb || poster || src;
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

function buildDayPageHtml({ origin, lang, day, prevDay, nextDay }) {
  const DAY_UI = {
    it: {
      titlePrefix: 'Diario Cammino',
      defaultDescription: (date) => `Pagina diario del Cammino di Santiago per il ${date}: foto, video, GPS e note del giorno.`,
      noMetadata: 'Nessun metadato',
      comments: 'Commenti',
      backToDiary: 'Torna al diario',
      openInteractiveDiary: 'Apri nel diario interattivo',
      openMap: 'Apri mappa',
      dayNotes: 'Note del giorno',
      noNotes: 'Nessuna nota disponibile.',
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
      recommendations: 'Posti consigliati'
    },
    en: {
      titlePrefix: 'Camino Diary',
      defaultDescription: (date) => `Camino de Santiago diary entry for ${date}: photos, videos, GPS and daily notes.`,
      noMetadata: 'No metadata',
      comments: 'Comments',
      backToDiary: 'Back to diary',
      openInteractiveDiary: 'Open in interactive diary',
      openMap: 'Open map',
      dayNotes: 'Day Notes',
      noNotes: 'No notes available.',
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
      recommendations: 'Recommended places'
    },
    es: {
      titlePrefix: 'Diario del Camino',
      defaultDescription: (date) => `Página del diario del Camino de Santiago para ${date}: fotos, vídeos, GPS y notas del día.`,
      noMetadata: 'Sin metadatos',
      comments: 'Comentarios',
      backToDiary: 'Volver al diario',
      openInteractiveDiary: 'Abrir en el diario interactivo',
      openMap: 'Abrir mapa',
      dayNotes: 'Notas del día',
      noNotes: 'No hay notas disponibles.',
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
      recommendations: 'Lugares recomendados'
    },
    fr: {
      titlePrefix: 'Journal du Chemin',
      defaultDescription: (date) => `Page du journal du Chemin de Saint-Jacques pour le ${date} : photos, vidéos, GPS et notes du jour.`,
      noMetadata: 'Aucune métadonnée',
      comments: 'Commentaires',
      backToDiary: 'Retour au journal',
      openInteractiveDiary: 'Ouvrir dans le journal interactif',
      openMap: 'Ouvrir la carte',
      dayNotes: 'Notes du jour',
      noNotes: 'Aucune note disponible.',
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
      recommendations: 'Lieux conseillés'
    }
  };
  const ui = DAY_UI[lang] || DAY_UI.it;
  const date = String(day && day.date ? day.date : '');
  const displayDate = formatDisplayDate(date, lang);
  const canonicalPath = `/${lang}/day/${date}/`;
  const canonicalUrl = buildAbsoluteUrl(origin, canonicalPath);
  const altItUrl = buildAbsoluteUrl(origin, `/it/day/${date}/`);
  const altEnUrl = buildAbsoluteUrl(origin, `/en/day/${date}/`);
  const altEsUrl = buildAbsoluteUrl(origin, `/es/day/${date}/`);
  const altFrUrl = buildAbsoluteUrl(origin, `/fr/day/${date}/`);
  const diaryUrl = buildAbsoluteUrl(origin, `/${lang}/?day=${encodeURIComponent(date)}`);
  const titlePrefix = ui.titlePrefix;
  const pageTitle = `${titlePrefix} · ${date}`;
  const description = firstTextParagraph(day && day.notes, 240) || ui.defaultDescription(date);
  const items = Array.isArray(day && day.items) ? day.items : [];
  const ogImagePath = normalizeImageCandidate(items.find((entry) => entry && (entry.type === 'image' || entry.type === 'video')) || null);
  const ogImageUrl = ogImagePath ? buildAbsoluteUrl(origin, `/${String(ogImagePath).replace(/^\/+/, '')}`) : '';
  const noteHtml = markdownToSafeHtml(day && day.notes ? day.notes : '');
  const recommendationsHtml = renderRecommendations(day && day.recommendations)
    .replace('__RECOMMENDATIONS_HEADING__', escapeHtml(ui.recommendations));
  const interactiveMediaBase = `${origin}/${lang}/?day=${encodeURIComponent(date)}&target=`;
  const mediaCards = items.slice(0, 32).map((item) => {
    const isVideo = String(item.type || '') === 'video';
    const mediaImg = mediaPath(item, 'thumb', date) || mediaPath(item, 'poster', date) || mediaPath(item, 'src', date);
    const mediaUrl = buildAbsoluteUrl(origin, `/${String(mediaImg || '').replace(/^\/+/, '')}`);
    const mediaSrc = buildAbsoluteUrl(origin, `/${String(mediaPath(item, 'src', date) || mediaImg || '').replace(/^\/+/, '')}`);
    const mediaPoster = buildAbsoluteUrl(origin, `/${String(mediaPath(item, 'poster', date) || mediaImg || '').replace(/^\/+/, '')}`);
    const labelTime = escapeHtml(String(item.time || ''));
    const place = escapeHtml(String(item.place || ''));
    const id = escapeHtml(String(item.id || ''));
    const rawId = String(item.id || '').trim();
    const duration = isVideo ? buildVideoDurationLabel(item.durationSec) : '';
    const meta = [labelTime, place].filter(Boolean).join(' · ');
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
          data-media-type="${isVideo ? 'video' : 'image'}"
          data-media-src="${escapeHtml(mediaSrc)}"
          data-media-poster="${escapeHtml(mediaPoster)}"
          data-media-meta="${escapeHtml(meta || ui.noMetadata)}"
        >
          ${mediaUrl ? `<img loading="lazy" src="${mediaUrl}" alt="${escapeHtml(`${displayDate} ${meta}`)}" />` : '<div class="media-fallback"></div>'}
        </a>
        ${commentTarget ? `<button type="button" class="day-comment-btn day-comment-btn--media" data-comment-target="${escapeHtml(commentTarget)}">${ui.comments}</button>` : ''}
        <div class="media-card__meta">${escapeHtml(meta || ui.noMetadata)}${duration ? ` · video ${escapeHtml(duration)}` : ''}</div>
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

  const navPrev = prevDay ? `<a href="/${lang}/day/${escapeHtml(prevDay.date)}/">← ${escapeHtml(prevDay.date)}</a>` : '';
  const navNext = nextDay ? `<a href="/${lang}/day/${escapeHtml(nextDay.date)}/">${escapeHtml(nextDay.date)} →</a>` : '';

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
  <style>
    body{max-width:1100px;margin:0 auto;padding:24px}
    .day-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
    .day-nav{display:flex;gap:12px;flex-wrap:wrap}
    .day-nav a,.back-link{display:inline-block;padding:8px 12px;border-radius:12px;background:#ece7df;color:#2d2823;text-decoration:none}
    .day-section{margin-top:18px;background:#fff;border-radius:16px;padding:16px}
    .media-grid{margin-top:16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
    .media-grid > .media-card{background:#f7f3ee;border-radius:12px;padding:8px;display:flex !important;flex-direction:column !important;align-items:stretch !important;justify-content:flex-start !important;gap:6px;min-height:0;overflow:visible}
    .media-grid > .media-card > a{display:block !important;width:100% !important;flex:0 0 auto !important}
    .media-grid > .media-card > a > img{width:100%;height:180px;object-fit:cover;border-radius:10px;display:block}
    .media-grid > .media-card > .media-card__meta{display:block !important;width:100% !important;font-size:12px;line-height:1.35;color:#5a5248;word-break:break-word;white-space:normal}
    .media-fallback{height:160px;border-radius:10px;background:#ddd}
    .hero-links{display:flex;gap:8px;flex-wrap:wrap}
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
      <h1>${escapeHtml(displayDate)} (${escapeHtml(date)})</h1>
      <div class="hero-links">
        <a class="back-link" href="${escapeHtml(diaryUrl)}">${ui.openInteractiveDiary}</a>
        <a class="back-link" href="/${lang}/map/">${ui.openMap}</a>
      </div>
    </div>
    <nav class="day-nav">${navPrev}${navNext}</nav>
  </header>
  <section class="day-section">
    <div class="day-comments-head">
      <h2>${ui.dayNotes}</h2>
      <button type="button" class="day-comment-btn" data-comment-target="note-${escapeHtml(date)}">${ui.comments}</button>
    </div>
    ${noteHtml || `<p>${ui.noNotes}</p>`}
  </section>
  ${recommendationsHtml}
  <section class="day-section">
    <h2>${ui.mediaHeading} (${items.length})</h2>
    <div class="media-grid">
      ${mediaCards || `<p>${ui.noMedia}</p>`}
    </div>
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
      const links = Array.from(document.querySelectorAll('.day-media-link'));
      let activeIndex = -1;
      let zoomCleanup = null;

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

      const openModal = (index) => {
        const link = links[index];
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
        prevBtn.disabled = links.length <= 1;
        nextBtn.disabled = links.length <= 1;
        modal.classList.add('is-open');
        modal.setAttribute('aria-hidden', 'false');
      };

      const openByOffset = (offset) => {
        if (!links.length) return;
        const base = activeIndex < 0 ? 0 : activeIndex;
        const next = (base + offset + links.length) % links.length;
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
        activeIndex = -1;
      };

      links.forEach((link, idx) => {
        link.addEventListener('click', (event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button === 1) return;
          event.preventDefault();
          openModal(idx);
        });
      });

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
</body>
</html>`;
}

async function buildSitemapXml(req) {
  const origin = getRequestOrigin(req);
  const itEntries = await readEntriesByLang('it');
  const days = Array.isArray(itEntries && itEntries.days) ? itEntries.days : [];
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
  for (const day of days) {
    const date = String(day && day.date ? day.date : '').trim();
    if (!date) continue;
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

function getRequestOrigin(req) {
  const protoHeader = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const hostHeader = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
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
  void reqUrl;
  const canonicalPath = `/${lang}/`;
  const canonical = `${origin}${canonicalPath}`;
  const altIt = `${origin}/it/`;
  const altEn = `${origin}/en/`;
  const altEs = `${origin}/es/`;
  const altFr = `${origin}/fr/`;
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
  const ogTags = [
    '<meta property="og:type" content="website" />',
    `<meta property="og:title" content="${escapeHtml(seo.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(seo.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    `<meta property="og:image" content="${escapeHtml(ogImage)}" />`,
    `<meta property="og:image:width" content="${OG_IMAGE_WIDTH}" />`,
    `<meta property="og:image:height" content="${OG_IMAGE_HEIGHT}" />`,
    `<meta property="og:image:type" content="${OG_IMAGE_TYPE}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${escapeHtml(seo.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(seo.description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(ogImage)}" />`
  ];
  out = out.replace('</head>', `  ${ogTags.join('\n  ')}\n</head>`);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: seo.title,
    description: seo.description,
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
    const html = buildDayPageHtml({
      origin: getRequestOrigin(req),
      lang,
      day,
      prevDay,
      nextDay
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

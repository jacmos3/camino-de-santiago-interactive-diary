const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'deploy-runtime');

const ROOT_FILES = [
  '.htaccess',
  'app.js',
  'conchiglia-nera.html',
  'contatti.html',
  'cookie-policy.html',
  'crea-il-tuo-diario.html',
  'day-page-map.js',
  'day.php',
  'favicon.ico',
  'favicon.png',
  'favicon.svg',
  'guida-gratuita.html',
  'index.html',
  'map.html',
  'map.js',
  'people.html',
  'people.js',
  'privacy-policy.html',
  'robots.txt',
  'sitemap.xml',
  'styles.css',
  'termini-e-condizioni.html'
];

const ROOT_DIRS = ['api', 'assets', 'assets-funnel', 'data'];
const OPTIONAL_ROOT_FILES = ['.env'];
const LOCALIZED_STATIC_ALIASES = [
  { source: 'index.html', slug: '' },
  { source: 'map.html', slug: 'map' },
  { source: 'people.html', slug: 'people' },
  { source: 'contatti.html', slug: 'contatti' },
  { source: 'crea-il-tuo-diario.html', slug: 'crea-il-tuo-diario' },
  {
    source: 'guida-gratuita.html',
    slugByLang: {
      it: 'guida-gratuita-al-cammino-di-santiago-francese',
      en: 'free-guide',
      es: 'guia-gratuita',
      fr: 'guide-gratuite'
    }
  }
];
const ROOT_ALIAS_PAGES = [
  { source: 'privacy-policy.html', slug: 'privacy-policy' },
  { source: 'cookie-policy.html', slug: 'cookie-policy' },
  { source: 'termini-e-condizioni.html', slug: 'termini-e-condizioni' }
];
const LANGS = ['it', 'en', 'es', 'fr'];
const LOCALIZED_SEO_BY_SOURCE = {
  'index.html': {
    robots: 'noindex,follow,max-image-preview:large',
    titleByLang: {
      it: 'Cammino di Santiago — Diario Visivo',
      en: 'Camino de Santiago — Visual Diary',
      es: 'Camino de Santiago — Diario Visual',
      fr: 'Chemin de Saint-Jacques — Journal Visuel'
    },
    descriptionByLang: {
      it: 'Diario visivo del Cammino di Santiago con foto, video, tracce GPS e racconti giornalieri.',
      en: 'Visual Camino de Santiago diary with photos, videos, GPS tracks, and day-by-day storytelling.',
      es: 'Diario visual del Camino de Santiago con fotos, vídeos, trazas GPS y relatos diarios.',
      fr: 'Journal visuel du Chemin de Saint-Jacques avec photos, vidéos, traces GPS et récits quotidiens.'
    },
    pathByLang: {
      it: '/it/',
      en: '/en/',
      es: '/es/',
      fr: '/fr/'
    }
  },
  'map.html': {
    robots: 'noindex,follow,max-image-preview:large',
    titleByLang: {
      it: 'Cammino di Santiago — Mappa',
      en: 'Camino de Santiago — Map',
      es: 'Camino de Santiago — Mapa',
      fr: 'Chemin de Saint-Jacques — Carte'
    },
    descriptionByLang: {
      it: 'Mappa interattiva del Cammino di Santiago con punti media giornalieri.',
      en: 'Interactive map of the Camino de Santiago route with daily media points.',
      es: 'Mapa interactivo del Camino de Santiago con puntos de medios diarios.',
      fr: 'Carte interactive du Chemin de Saint-Jacques avec points média quotidiens.'
    },
    pathByLang: {
      it: '/it/map/',
      en: '/en/map/',
      es: '/es/map/',
      fr: '/fr/map/'
    }
  },
  'people.html': {
    robots: 'noindex,follow,max-image-preview:large',
    titleByLang: {
      it: 'Cammino di Santiago — Persone',
      en: 'Camino de Santiago — People',
      es: 'Camino de Santiago — Personas',
      fr: 'Chemin de Saint-Jacques — Personnes'
    },
    descriptionByLang: {
      it: 'Persone incontrate sul Cammino di Santiago, ricostruite dalle note giornaliere.',
      en: 'People met on the Camino de Santiago, reconstructed from the daily notes.',
      es: 'Personas encontradas en el Camino de Santiago, reconstruidas a partir de las notas diarias.',
      fr: 'Personnes rencontrées sur le Chemin de Saint-Jacques, reconstituées à partir des notes quotidiennes.'
    },
    pathByLang: {
      it: '/it/people/',
      en: '/en/people/',
      es: '/es/people/',
      fr: '/fr/people/'
    }
  },
  'contatti.html': {
    robots: 'noindex,follow,max-image-preview:large',
    titleByLang: {
      it: 'Richiedi informazioni — Cammino di Santiago',
      en: 'Request information — Camino de Santiago',
      es: 'Solicita información — Camino de Santiago',
      fr: 'Demander des informations — Chemin de Saint-Jacques'
    },
    descriptionByLang: {
      it: 'Richiedi la guida pratica per preparare il Cammino oppure la call valutativa, il Builder Base o il servizio avanzato per trasformare il viaggio in un diario interattivo.',
      en: 'Request the practical guide to prepare the Camino, or the discovery call, Builder Base, or the advanced service to turn the trip into an interactive diary.',
      es: 'Solicita la guía práctica para preparar el Camino, o la llamada de valoración, el Builder Base o el servicio avanzado para transformar el viaje en un diario interactivo.',
      fr: 'Demande des informations sur le guide pratique pour préparer le Camino, ou sur l’appel, le Builder Base ou le service avancé pour transformer le voyage en journal interactif.'
    },
    pathByLang: {
      it: '/it/contatti/',
      en: '/en/contatti/',
      es: '/es/contatti/',
      fr: '/fr/contatti/'
    }
  },
  'guida-gratuita.html': {
    titleByLang: {
      it: 'Guida gratuita al Cammino di Santiago',
      en: 'Free Guide to the Camino de Santiago',
      es: 'Guía gratuita del Camino de Santiago',
      fr: 'Guide gratuite du Camino de Santiago'
    },
    descriptionByLang: {
      it: 'Una guida gratuita per capire se partire davvero e fare ordine tra dubbi, paure e motivazioni prima del Cammino di Santiago.',
      en: 'A free guide to understand whether you really want to go and to bring order to doubts, fears, and motivations before the Camino.',
      es: 'Una guía gratuita para entender si de verdad quieres partir y poner orden entre dudas, miedos y motivaciones antes del Camino.',
      fr: 'Un guide gratuit pour comprendre si vous voulez vraiment partir et remettre de l’ordre dans vos doutes, peurs et motivations avant le Camino.'
    },
    pathByLang: {
      it: '/it/guida-gratuita-al-cammino-di-santiago-francese/',
      en: '/en/free-guide/',
      es: '/es/guia-gratuita/',
      fr: '/fr/guide-gratuite/'
    }
  },
  'crea-il-tuo-diario.html': {
    titleByLang: {
      it: 'Percorso completo: dal Cammino al diario',
      en: 'Full path: from the Camino to the diary',
      es: 'Recorrido completo: del Camino al diario',
      fr: 'Parcours complet : du Camino au journal'
    },
    descriptionByLang: {
      it: 'Guida pratica, Builder Base e servizio avanzato per passare dal primo dubbio al diario finale del tuo viaggio.',
      en: 'Practical guide, Builder Base, and advanced service to move from the first doubt to the final diary of your trip.',
      es: 'Guía práctica, Builder Base y servicio avanzado para pasar de la primera duda al diario final de tu viaje.',
      fr: 'Guide pratique, Builder Base et service avancé pour passer du premier doute au journal final de votre voyage.'
    },
    pathByLang: {
      it: '/it/crea-il-tuo-diario/',
      en: '/en/crea-il-tuo-diario/',
      es: '/es/crea-il-tuo-diario/',
      fr: '/fr/crea-il-tuo-diario/'
    }
  }
};

function shouldSkipPath(srcPath) {
  const base = path.basename(srcPath);
  if (base === '.DS_Store') return true;
  if (base === '.gitkeep') return false;
  return false;
}

async function copyEntry(relativePath) {
  const src = path.join(ROOT, relativePath);
  const dst = path.join(OUTPUT_DIR, relativePath);
  if (!fsSync.existsSync(src)) return;
  await fs.cp(src, dst, {
    recursive: true,
    force: true,
    filter: (srcPath) => !shouldSkipPath(srcPath)
  });
}

function applyLocalizedSeo(rawHtml, sourceRelativePath, lang) {
  const seo = LOCALIZED_SEO_BY_SOURCE[sourceRelativePath];
  if (!seo || !lang) return rawHtml;

  const title = seo.titleByLang[lang] || seo.titleByLang.it;
  const description = seo.descriptionByLang[lang] || seo.descriptionByLang.it;
  const canonical = seo.pathByLang[lang] || seo.pathByLang.it;
  const xDefault = seo.pathByLang.it;
  const alternateTags = LANGS.map((currentLang) => {
    const href = seo.pathByLang[currentLang];
    if (!href) return '';
    return `  <link rel="alternate" hreflang="${currentLang}" href="${href}" />`;
  }).filter(Boolean);
  if (xDefault) {
    alternateTags.push(`  <link rel="alternate" hreflang="x-default" href="${xDefault}" />`);
  }

  let out = String(rawHtml || '');
  out = out.replace(/<html lang="[^"]*">/i, `<html lang="${lang}">`);
  out = out.replace(/(<title[^>]*>)[\s\S]*?(<\/title>)/i, `$1${title}$2`);

  if (/<meta[^>]*(?:id="page-description"|id="meta-description"|name="description")[^>]*content="/i.test(out)) {
    out = out.replace(
      /(<meta[^>]*(?:id="page-description"|id="meta-description"|name="description")[^>]*content=")[^"]*(")/i,
      `$1${description}$2`
    );
  } else {
    out = out.replace('</head>', `  <meta name="description" content="${description}" />\n</head>`);
  }

  if (/<meta[^>]*name="robots"[^>]*content="/i.test(out) && seo.robots) {
    out = out.replace(/(<meta[^>]*name="robots"[^>]*content=")[^"]*(")/i, `$1${seo.robots}$2`);
  } else if (seo.robots) {
    out = out.replace('</head>', `  <meta name="robots" content="${seo.robots}" />\n</head>`);
  }

  if (/<link[^>]*(?:id="seo-canonical"|rel="canonical")[^>]*href="/i.test(out)) {
    out = out.replace(
      /(<link[^>]*(?:id="seo-canonical"|rel="canonical")[^>]*href=")[^"]*(")/i,
      `$1${canonical}$2`
    );
  } else {
    out = out.replace('</head>', `  <link rel="canonical" href="${canonical}" />\n</head>`);
  }

  if (/id="seo-alt-it"/i.test(out)) {
    out = out.replace(/(<link[^>]*id="seo-alt-it"[^>]*href=")[^"]*(")/i, `$1${seo.pathByLang.it}$2`);
    out = out.replace(/(<link[^>]*id="seo-alt-en"[^>]*href=")[^"]*(")/i, `$1${seo.pathByLang.en}$2`);
    out = out.replace(/(<link[^>]*id="seo-alt-es"[^>]*href=")[^"]*(")/i, `$1${seo.pathByLang.es}$2`);
    out = out.replace(/(<link[^>]*id="seo-alt-fr"[^>]*href=")[^"]*(")/i, `$1${seo.pathByLang.fr}$2`);
    out = out.replace(/(<link[^>]*id="seo-alt-default"[^>]*href=")[^"]*(")/i, `$1${xDefault}$2`);
  } else {
    out = out.replace(/^\s*<link[^>]*rel="alternate"[^>]*hreflang="[^"]*"[^>]*>\s*$/gim, '');
    out = out.replace('</head>', `${alternateTags.join('\n')}\n</head>`);
  }

  return out;
}

async function createAliasIndex(targetDir, sourceRelativePath, lang = null) {
  const src = path.join(ROOT, sourceRelativePath);
  if (!fsSync.existsSync(src)) return;
  await fs.mkdir(targetDir, { recursive: true });
  const raw = await fs.readFile(src, 'utf8');
  const localized = applyLocalizedSeo(raw, sourceRelativePath, lang);
  await fs.writeFile(path.join(targetDir, 'index.html'), localized, 'utf8');
}

async function buildStaticAliasDirectories() {
  for (const lang of LANGS) {
    for (const entry of LOCALIZED_STATIC_ALIASES) {
      const localizedSlug = typeof entry.slugByLang === 'object'
        ? entry.slugByLang[lang]
        : entry.slug;
      const targetDir = localizedSlug
        ? path.join(OUTPUT_DIR, lang, localizedSlug)
        : path.join(OUTPUT_DIR, lang);
      await createAliasIndex(targetDir, entry.source, lang);
    }
  }
  for (const entry of ROOT_ALIAS_PAGES) {
    await createAliasIndex(path.join(OUTPUT_DIR, entry.slug), entry.source);
  }
}

async function main() {
  await fs.rm(OUTPUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  for (const file of ROOT_FILES) {
    await copyEntry(file);
  }
  for (const file of OPTIONAL_ROOT_FILES) {
    await copyEntry(file);
  }
  for (const dir of ROOT_DIRS) {
    await copyEntry(dir);
  }

  await buildStaticAliasDirectories();

  process.stdout.write(`deploy-runtime rebuilt at ${OUTPUT_DIR}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

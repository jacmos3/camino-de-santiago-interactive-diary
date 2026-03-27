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
  'debug-headers.php',
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
  'server.js',
  'sitemap.xml',
  'styles.css',
  'termini-e-condizioni.html'
];

const ROOT_DIRS = ['api', 'assets', 'data'];
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
      it: 'guida-gratuita',
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

async function writeDeployReadme() {
  const body = `# deploy-runtime

Cartella generata automaticamente da \`node scripts/build-deploy-runtime.js\`.

Contiene il pacchetto runtime da pubblicare sull'hosting:
- file statici pubblici
- \`api/\`
- \`data/\`
- \`assets/\`
- \`.htaccess\`

Se il tuo hosting usa la root del dominio come document root, carica il contenuto di questa cartella nella root pubblica del dominio.
`;
  await fs.writeFile(path.join(OUTPUT_DIR, 'README.md'), body, 'utf8');
}

async function createAliasIndex(targetDir, sourceRelativePath) {
  const src = path.join(ROOT, sourceRelativePath);
  if (!fsSync.existsSync(src)) return;
  await fs.mkdir(targetDir, { recursive: true });
  await fs.copyFile(src, path.join(targetDir, 'index.html'));
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
      await createAliasIndex(targetDir, entry.source);
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
  await writeDeployReadme();

  process.stdout.write(`deploy-runtime rebuilt at ${OUTPUT_DIR}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

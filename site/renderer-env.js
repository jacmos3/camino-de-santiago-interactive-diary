(() => {
  const BOOTSTRAP_DATA = (typeof window !== 'undefined' && window.__CAMMINO_BOOTSTRAP_DATA__ && typeof window.__CAMMINO_BOOTSTRAP_DATA__ === 'object')
    ? window.__CAMMINO_BOOTSTRAP_DATA__
    : null;
  const RENDERER_ENV = (typeof window !== 'undefined' && window.__CAMMINO_RENDERER_ENV__ && typeof window.__CAMMINO_RENDERER_ENV__ === 'object')
    ? window.__CAMMINO_RENDERER_ENV__
    : null;

  const getRendererEnvObject = (key) => {
    if (!RENDERER_ENV || typeof RENDERER_ENV !== 'object') return null;
    const value = RENDERER_ENV[key];
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  };

  const mergeI18nCatalog = (baseCatalog, overridesCatalog) => {
    if (!overridesCatalog) return baseCatalog;
    const merged = {};
    Object.entries(baseCatalog || {}).forEach(([lang, messages]) => {
      const overrideMessages = overridesCatalog[lang];
      merged[lang] = overrideMessages && typeof overrideMessages === 'object' && !Array.isArray(overrideMessages)
        ? { ...messages, ...overrideMessages }
        : { ...messages };
    });
    return merged;
  };

  const fallbackSlugify = (value) =>
    String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'person';

  window.CamminoRendererShell = {
    bootstrapData: BOOTSTRAP_DATA,
    env: RENDERER_ENV,
    getBootstrapEntriesData() {
      const payload = BOOTSTRAP_DATA && BOOTSTRAP_DATA.entriesData;
      return payload && typeof payload === 'object' ? payload : null;
    },
    buildUrl(kind, lang, params = null, extra = null) {
      if (!RENDERER_ENV || typeof RENDERER_ENV.buildUrl !== 'function') return '';
      try {
        const result = RENDERER_ENV.buildUrl(kind, { lang, params, extra });
        return typeof result === 'string' ? result.trim() : '';
      } catch {
        return '';
      }
    },
    feature(name, fallback) {
      if (!RENDERER_ENV || !RENDERER_ENV.features || typeof RENDERER_ENV.features !== 'object') return fallback;
      const value = RENDERER_ENV.features[name];
      return typeof value === 'boolean' ? value : fallback;
    },
    getI18n(baseCatalog) {
      return mergeI18nCatalog(baseCatalog, getRendererEnvObject('i18nOverrides'));
    },
    getThemeClass() {
      const raw = String(RENDERER_ENV && RENDERER_ENV.themeClass ? RENDERER_ENV.themeClass : '').trim();
      return raw || '';
    },
    applyTheme() {
      const themeClass = this.getThemeClass();
      if (!themeClass || typeof document === 'undefined') return;
      document.documentElement?.classList.add(themeClass);
      document.body?.classList.add(themeClass);
    },
    getContentOverride(key, lang) {
      const overrides = getRendererEnvObject('contentOverrides');
      if (!overrides) return '';
      const value = overrides[key];
      if (typeof value === 'string') return value;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const localized = value[lang];
        return typeof localized === 'string' ? localized : '';
      }
      return '';
    },
    getDayNumberingMode() {
      return String(RENDERER_ENV && RENDERER_ENV.dayNumbering ? RENDERER_ENV.dayNumbering : '').trim().toLowerCase();
    },
    getLegacyPeopleCatalog(fallback) {
      const catalog = Array.isArray(RENDERER_ENV && RENDERER_ENV.legacyPeopleCatalog)
        ? RENDERER_ENV.legacyPeopleCatalog
        : null;
      if (!catalog) return fallback;
      return catalog
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const name = String(entry.name || '').trim();
          if (!name) return null;
          const aliases = Array.isArray(entry.aliases)
            ? entry.aliases.map((value) => String(value || '').trim()).filter(Boolean)
            : [];
          return {
            id: String(entry.id || '').trim() || fallbackSlugify(name),
            name,
            aliases: aliases.length ? aliases : [name]
          };
        })
        .filter(Boolean);
    },
    getGpsInferenceExcludedOrig(fallback) {
      const configured = Array.isArray(RENDERER_ENV && RENDERER_ENV.gpsInferenceExcludedOrig)
        ? RENDERER_ENV.gpsInferenceExcludedOrig
        : null;
      return configured && configured.length
        ? configured.map((value) => String(value || '').trim().toUpperCase()).filter(Boolean)
        : fallback;
    }
  };
})();

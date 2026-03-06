const PEOPLE_PAGE_I18N = {
  it: {
    seoTitle: 'Cammino di Santiago — Persone',
    seoDescription: 'Persone incontrate sul Cammino di Santiago, ricostruite dalle note giornaliere.',
    eyebrow: 'Geografia umana del cammino',
    title: 'Persone del Cammino',
    lead: 'Una pagina dedicata agli incontri che ritornano, si intrecciano e diventano parte della storia.',
    loading: 'Caricamento persone…',
    back: 'Torna al diario',
    language: 'Lingua',
    hubTitle: 'Mappa relazionale delle persone',
    hubIntro: 'Ricostruzione automatica a partire dalle note giornaliere: chi compare, quando entra davvero nel racconto e con chi si intreccia.',
    empty: 'Nessuna persona rilevata nelle note disponibili.',
    summary: '{count} persone emerse dalle note',
    firstSeen: 'Prima comparsa',
    excerpt: 'Come entra nel racconto',
    connections: 'Si intreccia con',
    days: 'Giorni citati',
    dayCount: '{count} giorni',
    openDay: 'Apri nel diario'
  },
  en: {
    seoTitle: 'Camino de Santiago — People',
    seoDescription: 'People met on the Camino de Santiago, reconstructed from the daily notes.',
    eyebrow: 'Human map of the Camino',
    title: 'People on the Camino',
    lead: 'A dedicated page for the encounters that return, intertwine, and become part of the story.',
    loading: 'Loading people…',
    back: 'Back to diary',
    language: 'Language',
    hubTitle: 'Relationship map of people',
    hubIntro: 'Automatic reconstruction from the daily notes: who appears, when they truly enter the story, and who they intersect with.',
    empty: 'No people detected in the available notes.',
    summary: '{count} people surfaced from the notes',
    firstSeen: 'First appearance',
    excerpt: 'How they enter the story',
    connections: 'Connected with',
    days: 'Mentioned days',
    dayCount: '{count} days',
    openDay: 'Open in diary'
  },
  es: {
    seoTitle: 'Camino de Santiago — Personas',
    seoDescription: 'Personas encontradas en el Camino de Santiago, reconstruidas a partir de las notas diarias.',
    eyebrow: 'Geografía humana del Camino',
    title: 'Personas del Camino',
    lead: 'Una página dedicada a los encuentros que vuelven, se cruzan y terminan formando parte de la historia.',
    loading: 'Cargando personas…',
    back: 'Volver al diario',
    language: 'Idioma',
    hubTitle: 'Mapa relacional de personas',
    hubIntro: 'Reconstrucción automática a partir de las notas diarias: quién aparece, cuándo entra realmente en el relato y con quién se cruza.',
    empty: 'No se detectaron personas en las notas disponibles.',
    summary: '{count} personas surgidas de las notas',
    firstSeen: 'Primera aparición',
    excerpt: 'Cómo entra en el relato',
    connections: 'Se cruza con',
    days: 'Días mencionados',
    dayCount: '{count} días',
    openDay: 'Abrir en el diario'
  },
  fr: {
    seoTitle: 'Chemin de Saint-Jacques — Personnes',
    seoDescription: 'Personnes rencontrées sur le Chemin de Saint-Jacques, reconstituées à partir des notes quotidiennes.',
    eyebrow: 'Géographie humaine du Chemin',
    title: 'Personnes du Chemin',
    lead: 'Une page dédiée aux rencontres qui reviennent, se croisent et deviennent une partie de l’histoire.',
    loading: 'Chargement des personnes…',
    back: 'Retour au journal',
    language: 'Langue',
    hubTitle: 'Carte relationnelle des personnes',
    hubIntro: 'Reconstruction automatique à partir des notes quotidiennes: qui apparaît, quand cette personne entre vraiment dans l’histoire et avec qui elle se croise.',
    empty: 'Aucune personne détectée dans les notes disponibles.',
    summary: '{count} personnes ressortent des notes',
    firstSeen: 'Première apparition',
    excerpt: 'Comment la personne entre dans le récit',
    connections: 'Liens avec',
    days: 'Jours mentionnés',
    dayCount: '{count} jours',
    openDay: 'Ouvrir dans le journal'
  }
};

const PEOPLE_CATALOG = [
  { id: 'maria', name: 'Maria', aliases: ['Maria'] },
  { id: 'thomas', name: 'Thomas', aliases: ['Thomas', 'Tomà', 'Toma'] },
  { id: 'talia', name: 'Talia', aliases: ['Talia'] },
  { id: 'alicia', name: 'Alicia', aliases: ['Alicia'] },
  { id: 'ananda', name: 'Ananda', aliases: ['Ananda'] },
  { id: 'beatrice', name: 'Beatrice', aliases: ['Beatrice'] },
  { id: 'catherine', name: 'Catherine', aliases: ['Catherine'] },
  { id: 'charles', name: 'Charles', aliases: ['Charles'] },
  { id: 'francesco', name: 'Francesco', aliases: ['Francesco'] },
  { id: 'hongsuan', name: 'Hongsuan', aliases: ['Hongsuan', 'Ocean'] },
  { id: 'andrius', name: 'Andrius', aliases: ['Andrius'] },
  { id: 'giselle', name: 'Giselle', aliases: ['Giselle'] },
  { id: 'judith', name: 'Judith', aliases: ['Judith'] },
  { id: 'lucia', name: 'Lucia', aliases: ['Lucia', 'Lucía'] },
  { id: 'mark', name: 'Mark', aliases: ['Mark'] },
  { id: 'pamela', name: 'Pamela', aliases: ['Pamela', 'Pam'] },
  { id: 'chris', name: 'Chris', aliases: ['Chris'] },
  { id: 'jessica', name: 'Jessica', aliases: ['Jessica'] },
  { id: 'danielle', name: 'Danielle', aliases: ['Danielle'] },
  { id: 'ginger', name: 'Ginger', aliases: ['Ginger'] },
  { id: 'carla', name: 'Carla', aliases: ['Carla'] },
  { id: 'anita', name: 'Anita', aliases: ['Anita'] },
  { id: 'isabel', name: 'Isabel', aliases: ['Isabel'] },
  { id: 'sara', name: 'Sara', aliases: ['Sara'] },
  { id: 'renato', name: 'Renato', aliases: ['Renato'] },
  { id: 'laura', name: 'Laura', aliases: ['Laura'] },
  { id: 'juan', name: 'Juan', aliases: ['Juan', 'Juean', 'Joan'] },
  { id: 'matteo', name: 'Matteo', aliases: ['Matteo'] },
  { id: 'stefano', name: 'Stefano', aliases: ['Stefano'] },
  { id: 'maddalena', name: 'Maddalena', aliases: ['Maddalena'] },
  { id: 'antonella', name: 'Antonella', aliases: ['Antonella'] }
];

const SUPPORTED_LANGS = new Set(['it', 'en', 'es', 'fr']);
let currentLang = 'it';
let peopleIndex = [];

const normalizeLang = (value) => {
  const lang = String(value || '').trim().toLowerCase();
  return SUPPORTED_LANGS.has(lang) ? lang : 'it';
};

const getLangFromPath = () => {
  const match = String(window.location.pathname || '').match(/^\/(it|en|es|fr)(?:\/|$)/i);
  return normalizeLang(match ? match[1] : 'it');
};

const buildDiaryDayUrl = (lang, day) => `/${normalizeLang(lang)}/?day=${encodeURIComponent(day)}#note-${encodeURIComponent(day)}`;
const buildDiaryHomeUrl = (lang) => `/${normalizeLang(lang)}/`;
const buildPeopleUrl = (lang) => `/${normalizeLang(lang)}/people/`;
const buildEntriesUrl = (lang) => `/data/entries.${normalizeLang(lang)}.json`;
const STATIC_DATA_VERSION = (() => {
  try {
    const script = Array.from(document.scripts || []).find((node) => /\/people\.js(?:\?|$)/.test(String(node.src || '')));
    if (script && script.src) {
      const parsed = new URL(script.src, window.location.origin);
      const value = String(parsed.searchParams.get('v') || '').trim();
      if (value) return value;
    }
  } catch {
    // ignore
  }
  return '1';
})();
const buildVersionedEntriesUrl = (lang) => {
  const url = buildEntriesUrl(lang);
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${encodeURIComponent(STATIC_DATA_VERSION)}`;
};

const formatTemplate = (template, vars = {}) => String(template || '').replace(/\{(\w+)\}/g, (_, key) => {
  const value = vars[key];
  return value == null ? '' : String(value);
});

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const stripNoteMarkup = (text) => String(text || '')
  .replace(/\*\*/g, '')
  .replace(/[_`>#-]+/g, ' ')
  .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
  .replace(/\s+/g, ' ')
  .trim();

const buildPersonRegex = (aliases) => new RegExp(`(?<![\\p{L}\\p{N}_])(?:${aliases.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}_])`, 'giu');

const getNote = (day) => {
  const note = day ? day.notes : '';
  if (typeof note === 'string') return note;
  if (note && typeof note === 'object') {
    const fallbackOrder = [currentLang, 'it', 'en', 'es', 'fr'];
    for (const lang of fallbackOrder) {
      const value = note[lang];
      if (typeof value === 'string' && value.trim()) return value;
    }
  }
  return '';
};

const formatDate = (dateStr) => {
  const [year, month, day] = String(dateStr || '').split('-').map(Number);
  const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  const localeMap = { it: 'it-IT', en: 'en-US', es: 'es-ES', fr: 'fr-FR' };
  return new Intl.DateTimeFormat(localeMap[currentLang] || 'it-IT', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(date);
};

const formatDateCompact = (dateStr) => {
  const [year, month, day] = String(dateStr || '').split('-').map(Number);
  const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  const localeMap = { it: 'it-IT', en: 'en-US', es: 'es-ES', fr: 'fr-FR' };
  return new Intl.DateTimeFormat(localeMap[currentLang] || 'it-IT', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC'
  }).format(date);
};

const buildExcerptAroundMatch = (text, matchIndex, matchLength) => {
  const normalized = stripNoteMarkup(text);
  if (!normalized) return '';
  const start = Math.max(0, matchIndex - 72);
  const end = Math.min(normalized.length, matchIndex + matchLength + 96);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < normalized.length ? '…' : '';
  return `${prefix}${normalized.slice(start, end).trim()}${suffix}`;
};

const analyzePeople = (days) => {
  const people = PEOPLE_CATALOG.map((person) => ({
    ...person,
    regex: buildPersonRegex(person.aliases),
    mentions: 0,
    days: [],
    excerpt: '',
    related: []
  }));
  const byId = new Map(people.map((person) => [person.id, person]));
  const cooccurrence = new Map();

  (days || []).forEach((day) => {
    const noteText = stripNoteMarkup(getNote(day));
    if (!noteText) return;
    const present = [];
    people.forEach((person) => {
      person.regex.lastIndex = 0;
      const matches = [...noteText.matchAll(person.regex)];
      if (!matches.length) return;
      person.mentions += matches.length;
      person.days.push({
        date: day.date,
        title: formatDate(day.date)
      });
      if (!person.excerpt) {
        const first = matches[0];
        person.excerpt = buildExcerptAroundMatch(noteText, first.index || 0, first[0].length);
      }
      present.push(person.id);
    });
    for (let i = 0; i < present.length; i += 1) {
      for (let j = i + 1; j < present.length; j += 1) {
        const key = [present[i], present[j]].sort().join('::');
        cooccurrence.set(key, (cooccurrence.get(key) || 0) + 1);
      }
    }
  });

  cooccurrence.forEach((weight, pairKey) => {
    const [leftId, rightId] = pairKey.split('::');
    const left = byId.get(leftId);
    const right = byId.get(rightId);
    if (!left || !right) return;
    left.related.push({ id: right.id, name: right.name, weight });
    right.related.push({ id: left.id, name: left.name, weight });
  });

  return people
    .filter((person) => person.days.length)
    .map((person) => ({
      ...person,
      firstDay: person.days[0],
      related: person.related.sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name)).slice(0, 4)
    }))
    .sort((a, b) => b.days.length - a.days.length || b.mentions - a.mentions || a.name.localeCompare(b.name));
};

const setSeo = () => {
  const ui = PEOPLE_PAGE_I18N[currentLang];
  document.title = ui.seoTitle;
  const description = document.querySelector('meta[name="description"]');
  if (description) description.setAttribute('content', ui.seoDescription);
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.setAttribute('href', buildPeopleUrl(currentLang));
};

const renderPageChrome = () => {
  const ui = PEOPLE_PAGE_I18N[currentLang];
  const eyebrow = document.querySelector('.eyebrow');
  if (eyebrow) eyebrow.textContent = ui.eyebrow;
  const title = document.querySelector('.hero__title h1');
  if (title) title.textContent = ui.title;
  const lead = document.querySelector('.hero__title .lead');
  if (lead) lead.textContent = ui.lead;
  const back = document.querySelector('.view-btn');
  if (back) {
    back.textContent = ui.back;
    back.href = buildDiaryHomeUrl(currentLang);
  }
  const langLabel = document.querySelector('.lang-select__label');
  if (langLabel) langLabel.textContent = ui.language;
  const langSelect = document.getElementById('people-lang-select');
  if (langSelect) langSelect.value = currentLang;
  setSeo();
};

const renderPeoplePage = () => {
  const ui = PEOPLE_PAGE_I18N[currentLang];
  const root = document.getElementById('people-page-root');
  if (!root) return;
  root.className = 'people-hub';
  root.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'people-hub__head';
  const titleWrap = document.createElement('div');
  const title = document.createElement('h2');
  title.className = 'people-hub__title';
  title.textContent = ui.hubTitle;
  const intro = document.createElement('p');
  intro.className = 'people-hub__intro';
  intro.textContent = ui.hubIntro;
  titleWrap.appendChild(title);
  titleWrap.appendChild(intro);
  const summary = document.createElement('div');
  summary.className = 'people-hub__summary';
  summary.textContent = formatTemplate(ui.summary, { count: peopleIndex.length });
  head.appendChild(titleWrap);
  head.appendChild(summary);
  root.appendChild(head);

  if (!peopleIndex.length) {
    const empty = document.createElement('p');
    empty.className = 'people-hub__empty';
    empty.textContent = ui.empty;
    root.appendChild(empty);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'people-hub__grid';
  peopleIndex.forEach((person) => {
    const card = document.createElement('article');
    card.className = 'people-card';
    card.id = `person-${person.id}`;

    const top = document.createElement('div');
    top.className = 'people-card__top';
    const name = document.createElement('h3');
    name.className = 'people-card__name';
    name.textContent = person.name;
    const count = document.createElement('div');
    count.className = 'people-card__count';
    count.textContent = formatTemplate(ui.dayCount, { count: person.days.length });
    top.appendChild(name);
    top.appendChild(count);
    card.appendChild(top);

    const first = document.createElement('p');
    first.className = 'people-card__first';
    first.textContent = `${ui.firstSeen}: ${person.firstDay ? person.firstDay.title : ''}`;
    card.appendChild(first);

    if (person.excerpt) {
      const excerptBlock = document.createElement('div');
      excerptBlock.className = 'people-card__block';
      const label = document.createElement('div');
      label.className = 'people-card__label';
      label.textContent = ui.excerpt;
      const excerpt = document.createElement('p');
      excerpt.className = 'people-card__excerpt';
      excerpt.textContent = person.excerpt;
      excerptBlock.appendChild(label);
      excerptBlock.appendChild(excerpt);
      card.appendChild(excerptBlock);
    }

    if (person.related.length) {
      const relatedBlock = document.createElement('div');
      relatedBlock.className = 'people-card__block';
      const relatedLabel = document.createElement('div');
      relatedLabel.className = 'people-card__label';
      relatedLabel.textContent = ui.connections;
      const chips = document.createElement('div');
      chips.className = 'people-card__chips';
      person.related.forEach((rel) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'people-chip people-chip--related';
        chip.textContent = `${rel.name} · ${rel.weight}`;
        chip.addEventListener('click', () => {
          const target = document.getElementById(`person-${rel.id}`);
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        chips.appendChild(chip);
      });
      relatedBlock.appendChild(relatedLabel);
      relatedBlock.appendChild(chips);
      card.appendChild(relatedBlock);
    }

    const daysBlock = document.createElement('div');
    daysBlock.className = 'people-card__block';
    const daysLabel = document.createElement('div');
    daysLabel.className = 'people-card__label';
    daysLabel.textContent = ui.days;
    const daysChips = document.createElement('div');
    daysChips.className = 'people-card__chips people-card__chips--scroll';
    person.days.forEach((day) => {
      const chip = document.createElement('a');
      chip.className = 'people-chip';
      chip.href = buildDiaryDayUrl(currentLang, day.date);
      chip.textContent = formatDateCompact(day.date);
      daysChips.appendChild(chip);
    });
    daysBlock.appendChild(daysLabel);
    daysBlock.appendChild(daysChips);
    card.appendChild(daysBlock);

    const actions = document.createElement('div');
    actions.className = 'people-card__actions';
    const openBtn = document.createElement('a');
    openBtn.className = 'people-action people-action--primary';
    openBtn.href = buildDiaryDayUrl(currentLang, person.firstDay.date);
    openBtn.textContent = ui.openDay;
    actions.appendChild(openBtn);
    card.appendChild(actions);

    grid.appendChild(card);
  });
  root.appendChild(grid);
};

const loadPeople = async () => {
  const root = document.getElementById('people-page-root');
  if (root) root.textContent = PEOPLE_PAGE_I18N[currentLang].loading;
  const response = await fetch(buildVersionedEntriesUrl(currentLang));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const days = Array.isArray(payload && payload.days) ? payload.days : [];
  peopleIndex = analyzePeople(days);
  renderPeoplePage();
};

const init = async () => {
  currentLang = getLangFromPath();
  renderPageChrome();
  const langSelect = document.getElementById('people-lang-select');
  if (langSelect) {
    langSelect.addEventListener('change', () => {
      const nextLang = normalizeLang(langSelect.value);
      if (nextLang === currentLang) return;
      window.location.href = buildPeopleUrl(nextLang);
    });
  }
  try {
    await loadPeople();
  } catch (err) {
    const root = document.getElementById('people-page-root');
    if (root) {
      root.className = 'people-hub';
      root.innerHTML = `<p class="people-hub__empty">${String(err && err.message ? err.message : err)}</p>`;
    }
  }
};

window.addEventListener('DOMContentLoaded', init);

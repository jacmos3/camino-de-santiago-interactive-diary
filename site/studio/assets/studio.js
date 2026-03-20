const state = {
  authenticated: false,
  projects: [],
  currentProject: null,
  currentDays: [],
  currentDay: null,
  dayPeople: [],
  detectedPeopleSuggestions: []
};

const el = {
  loginCard: document.getElementById('login-card'),
  loginForm: document.getElementById('login-form'),
  loginPassword: document.getElementById('login-password'),
  projectsCard: document.getElementById('projects-card'),
  projectsList: document.getElementById('projects-list'),
  projectCreateForm: document.getElementById('project-create-form'),
  projectCreateTitle: document.getElementById('project-create-title'),
  projectCreateSlug: document.getElementById('project-create-slug'),
  logoutBtn: document.getElementById('logout-btn'),
  statusBanner: document.getElementById('status-banner'),
  projectPanel: document.getElementById('project-panel'),
  projectPanelTitle: document.getElementById('project-panel-title'),
  projectMeta: document.getElementById('project-meta'),
  projectPreviewBtn: document.getElementById('project-preview-btn'),
  projectPublishBtn: document.getElementById('project-publish-btn'),
  projectPreviewLink: document.getElementById('project-preview-link'),
  projectPublishedLink: document.getElementById('project-published-link'),
  projectForm: document.getElementById('project-form'),
  projectTitle: document.getElementById('project-title'),
  projectSlug: document.getElementById('project-slug'),
  projectSubtitle: document.getElementById('project-subtitle'),
  projectAuthorName: document.getElementById('project-author-name'),
  projectPrimaryLang: document.getElementById('project-primary-lang'),
  projectPublicBasePath: document.getElementById('project-public-base-path'),
  projectIntroText: document.getElementById('project-intro-text'),
  daysPanel: document.getElementById('days-panel'),
  daysList: document.getElementById('days-list'),
  dayCreateForm: document.getElementById('day-create-form'),
  dayCreateDate: document.getElementById('day-create-date'),
  dayEditorTitle: document.getElementById('day-editor-title'),
  dayEditorMeta: document.getElementById('day-editor-meta'),
  dayForm: document.getElementById('day-form'),
  dayDate: document.getElementById('day-date'),
  dayNumber: document.getElementById('day-number'),
  dayTitle: document.getElementById('day-title'),
  dayArrivalPlace: document.getElementById('day-arrival-place'),
  dayCanonicalPath: document.getElementById('day-canonical-path'),
  dayStravaUrl: document.getElementById('day-strava-url'),
  dayPeopleSuggestions: document.getElementById('day-people-suggestions'),
  dayPeopleChips: document.getElementById('day-people-chips'),
  dayPeopleInput: document.getElementById('day-people-input'),
  dayPeopleAdd: document.getElementById('day-people-add'),
  dayPeopleSuggest: document.getElementById('day-people-suggest'),
  dayPeopleValidation: document.getElementById('day-people-validation'),
  dayPeopleTextPreview: document.getElementById('day-people-text-preview'),
  daySummary: document.getElementById('day-summary'),
  dayNotesWhere: document.getElementById('day-notes-where'),
  dayNotesScene: document.getElementById('day-notes-scene'),
  dayNotesSensory: document.getElementById('day-notes-sensory'),
  dayNotesLearned: document.getElementById('day-notes-learned'),
  dayNotesPractical: document.getElementById('day-notes-practical'),
  mediaUploadForm: document.getElementById('media-upload-form'),
  mediaFiles: document.getElementById('media-files'),
  mediaList: document.getElementById('media-list'),
  jobsList: document.getElementById('jobs-list')
};

const showStatus = (message, isError = false) => {
  if (!message) {
    el.statusBanner.textContent = '';
    el.statusBanner.classList.add('hidden');
    el.statusBanner.classList.remove('is-error');
    return;
  }
  el.statusBanner.textContent = message;
  el.statusBanner.classList.remove('hidden');
  el.statusBanner.classList.toggle('is-error', !!isError);
};

const escapeHtml = (value) =>
  String(value || '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch] || ch));

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizePersonName = (value) => String(value || '').trim().replace(/\s+/g, ' ');

const uniquePeople = (items) => {
  const map = new Map();
  (items || []).forEach((item) => {
    const clean = normalizePersonName(item);
    if (!clean) return;
    const key = clean.toLocaleLowerCase('it-IT');
    if (!map.has(key)) map.set(key, clean);
  });
  return Array.from(map.values());
};

const noteFields = () => [
  el.daySummary,
  el.dayNotesWhere,
  el.dayNotesScene,
  el.dayNotesSensory,
  el.dayNotesLearned,
  el.dayNotesPractical
];

const currentDayText = () => noteFields().map((field) => String(field && field.value || '').trim()).filter(Boolean).join('\n\n');

const personMatchesInText = (name, text) => {
  const clean = normalizePersonName(name);
  if (!clean || !text) return [];
  const regex = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(clean)}(?![\\p{L}\\p{N}_])`, 'giu');
  return Array.from(text.matchAll(regex));
};

const projectPeopleSuggestions = () => {
  const currentDayId = state.currentDay ? Number(state.currentDay.id) : 0;
  const previous = [];
  (state.currentDays || []).forEach((day) => {
    if (Number(day.id) === currentDayId) return;
    (Array.isArray(day.people) ? day.people : []).forEach((person) => previous.push(person));
  });
  return uniquePeople(previous);
};

const PERSON_SUGGESTION_STOPWORDS = new Set([
  'Il', 'Lo', 'La', 'I', 'Gli', 'Le', 'Un', 'Una', 'Uno',
  'Da', 'Di', 'A', 'In', 'Su', 'Per', 'Con', 'Tra', 'Fra',
  'E', 'Ma', 'Poi', 'Oggi', 'Ieri', 'Domani', 'Qui', 'Questa', 'Questo',
  'Dove', 'Scena', 'Dettaglio', 'Nota', 'Una', 'Summary', 'Link', 'Strava',
  'Cammino', 'Camino', 'Chemin', 'Giorno', 'Day', 'Days', 'Preview', 'Studio',
  'Lourdes', 'Santiago', 'Finisterre', 'Muxia', 'Muxía', 'Pamplona', 'Bergamo',
  'Milano', 'Perugia', 'Italia', 'Spagna', 'Francia', 'Belgio'
].map((value) => value.toLocaleLowerCase('it-IT')));

const extractPeopleCandidatesFromText = (text) => {
  const source = String(text || '');
  if (!source.trim()) return [];
  const counts = new Map();
  const regex = /(^|[\s([{"'«»])([A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ'’-]{2,})(?=$|[\s)\]}:;,.!?'"«»])/gu;
  let match;
  while ((match = regex.exec(source))) {
    const name = normalizePersonName(match[2] || '');
    if (!name) continue;
    const lowered = name.toLocaleLowerCase('it-IT');
    if (PERSON_SUGGESTION_STOPWORDS.has(lowered)) continue;
    if (/^\d/.test(name)) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'it'))
    .map(([name]) => name);
};

const renderPeoplePreview = () => {
  const text = currentDayText();
  const people = uniquePeople(state.dayPeople);
  if (!people.length) {
    el.dayPeopleValidation.innerHTML = '';
    el.dayPeopleTextPreview.innerHTML = '';
    return;
  }
  const validations = people.map((person) => {
    const matches = personMatchesInText(person, text);
    return {
      person,
      matches,
      ok: matches.length > 0,
    };
  });
  el.dayPeopleValidation.innerHTML = validations.map((item) => `
    <div class="people-validation__item ${item.ok ? 'people-validation__item--ok' : 'people-validation__item--missing'}">
      ${item.ok
        ? `${escapeHtml(item.person)} citato ${item.matches.length} volta${item.matches.length === 1 ? '' : 'e'}`
        : `${escapeHtml(item.person)} non appare citato nel testo corrente`}
    </div>
  `).join('');
  if (!text) {
    el.dayPeopleTextPreview.innerHTML = '<div class="people-validation__item">Nessun testo da validare.</div>';
    return;
  }
  const ranges = [];
  validations.forEach((item) => {
    item.matches.forEach((match) => {
      if (typeof match.index !== 'number') return;
      ranges.push({ start: match.index, end: match.index + match[0].length });
    });
  });
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  ranges.forEach((range) => {
    const last = merged[merged.length - 1];
    if (!last || range.start >= last.end) {
      merged.push({ ...range });
    } else {
      last.end = Math.max(last.end, range.end);
    }
  });
  let cursor = 0;
  let html = '';
  merged.forEach((range) => {
    html += escapeHtml(text.slice(cursor, range.start));
    html += `<mark>${escapeHtml(text.slice(range.start, range.end))}</mark>`;
    cursor = range.end;
  });
  html += escapeHtml(text.slice(cursor));
  el.dayPeopleTextPreview.innerHTML = html.replace(/\n/g, '<br>');
};

const removeDayPerson = (person) => {
  const target = normalizePersonName(person).toLocaleLowerCase('it-IT');
  state.dayPeople = state.dayPeople.filter((item) => normalizePersonName(item).toLocaleLowerCase('it-IT') !== target);
  renderPeopleEditor();
};

const addDayPerson = (person) => {
  const clean = normalizePersonName(person);
  if (!clean) return;
  state.dayPeople = uniquePeople([...state.dayPeople, clean]);
  if (el.dayPeopleInput) el.dayPeopleInput.value = '';
  renderPeopleEditor();
};

const renderPeopleEditor = () => {
  const selected = uniquePeople(state.dayPeople);
  const isSelected = (person) => selected.some((chosen) => chosen.localeCompare(person, 'it', { sensitivity: 'accent' }) === 0);
  const previousSuggestions = projectPeopleSuggestions().filter((person) => !isSelected(person));
  const detectedSuggestions = uniquePeople(state.detectedPeopleSuggestions).filter((person) => !isSelected(person) && !previousSuggestions.some((candidate) => candidate.localeCompare(person, 'it', { sensitivity: 'accent' }) === 0));
  el.dayPeopleChips.innerHTML = selected.map((person) => `
    <span class="chip chip--removable">
      ${escapeHtml(person)}
      <button type="button" class="chip__remove" data-remove-person="${escapeHtml(person)}" aria-label="Rimuovi ${escapeHtml(person)}">×</button>
    </span>
  `).join('');
  const html = [];
  previousSuggestions.forEach((person) => {
    html.push(`<button type="button" class="chip chip--button" data-suggest-person="${escapeHtml(person)}">${escapeHtml(person)}</button>`);
  });
  detectedSuggestions.forEach((person) => {
    html.push(`<button type="button" class="chip chip--button chip--suggested" data-suggest-person="${escapeHtml(person)}">${escapeHtml(person)} · testo</button>`);
  });
  el.dayPeopleSuggestions.innerHTML = html.join('');
  el.dayPeopleChips.querySelectorAll('[data-remove-person]').forEach((button) => {
    button.addEventListener('click', () => removeDayPerson(button.getAttribute('data-remove-person') || ''));
  });
  el.dayPeopleSuggestions.querySelectorAll('[data-suggest-person]').forEach((button) => {
    button.addEventListener('click', () => addDayPerson(button.getAttribute('data-suggest-person') || ''));
  });
  renderPeoplePreview();
};

const apiFetch = async (path, options = {}) => {
  const response = await fetch(`./api/${String(path || '').replace(/^\/+/, '')}`, {
    credentials: 'same-origin',
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
};

const apiJson = (path, method = 'GET', body = null) => {
  const options = { method, headers: {} };
  if (body !== null) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  return apiFetch(path, options);
};

const processDay = async (dayId) => apiJson(`days/${dayId}/process`, 'POST', {});

const setAuthUi = (authenticated) => {
  state.authenticated = !!authenticated;
  el.loginCard.classList.toggle('hidden', state.authenticated);
  el.projectsCard.classList.toggle('hidden', !state.authenticated);
  el.projectPanel.classList.toggle('hidden', !state.authenticated || !state.currentProject);
  el.daysPanel.classList.toggle('hidden', !state.authenticated || !state.currentProject);
};

const renderProjects = () => {
  if (!state.projects.length) {
    el.projectsList.innerHTML = '<div class="empty-state">Nessun progetto ancora creato.</div>';
    return;
  }
  el.projectsList.innerHTML = state.projects.map((project) => {
    const active = state.currentProject && Number(state.currentProject.id) === Number(project.id);
    return `
      <div class="project-item ${active ? 'is-active' : ''}">
        <button type="button" data-project-id="${project.id}">
          <strong>${escapeHtml(project.title)}</strong>
          <div class="project-item__meta">${escapeHtml(project.slug)} · ${escapeHtml(project.status)}</div>
          <div class="project-item__meta">${Number(project.days_count || 0)} giorni</div>
        </button>
      </div>
    `;
  }).join('');
  el.projectsList.querySelectorAll('[data-project-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const projectId = Number(button.getAttribute('data-project-id') || 0);
      if (projectId) void loadProject(projectId);
    });
  });
};

const renderProjectForm = () => {
  const p = state.currentProject;
  if (!p) {
    el.projectPanel.classList.add('hidden');
    return;
  }
  el.projectPanel.classList.remove('hidden');
  el.projectPanelTitle.textContent = p.title || 'Progetto';
  el.projectMeta.innerHTML = `
    <span class="chip">${escapeHtml(p.status || 'draft')}</span>
    <span>${escapeHtml(p.public_base_path || '')}</span>
  `;
  el.projectTitle.value = p.title || '';
  el.projectSlug.value = p.slug || '';
  el.projectSubtitle.value = p.subtitle || '';
  el.projectAuthorName.value = p.author_name || '';
  el.projectPrimaryLang.value = p.primary_lang || 'it';
  el.projectPublicBasePath.value = p.public_base_path || '';
  el.projectIntroText.value = p.intro_text || '';
  const previewUrl = p.preview_url || '';
  const publishedUrl = p.published_url || '';
  el.projectPreviewLink.href = previewUrl;
  el.projectPreviewLink.textContent = previewUrl;
  el.projectPreviewLink.classList.toggle('hidden', !previewUrl);
  el.projectPublishedLink.href = publishedUrl;
  el.projectPublishedLink.textContent = publishedUrl;
  el.projectPublishedLink.classList.toggle('hidden', !publishedUrl);
  el.projectPreviewBtn.disabled = !previewUrl;
  el.projectPublishBtn.disabled = false;
};

const renderDays = () => {
  if (!state.currentDays.length) {
    el.daysList.innerHTML = '<div class="empty-state">Nessun giorno creato.</div>';
    return;
  }
  el.daysList.innerHTML = state.currentDays.map((day) => {
    const active = state.currentDay && Number(state.currentDay.id) === Number(day.id);
    return `
      <div class="day-item ${active ? 'is-active' : ''}">
        <button type="button" data-day-id="${day.id}">
          <strong>${escapeHtml(day.date)}</strong>
          <div class="day-item__meta">${escapeHtml(day.title || 'Titolo non impostato')}</div>
          <div class="day-item__meta">${escapeHtml(day.arrival_place || 'Luogo arrivo non impostato')}</div>
          <div class="day-item__meta">${escapeHtml(day.processing_state || 'idle')} · ${Number(day.media_count || 0)} media</div>
        </button>
      </div>
    `;
  }).join('');
  el.daysList.querySelectorAll('[data-day-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const dayId = Number(button.getAttribute('data-day-id') || 0);
      if (dayId) void loadDay(dayId);
    });
  });
};

const renderDayEditor = () => {
  const day = state.currentDay;
  if (!day) {
    el.dayEditorTitle.textContent = 'Seleziona un giorno';
    el.dayEditorMeta.textContent = '';
    el.dayForm.reset();
    el.mediaList.innerHTML = '<div class="empty-state">Nessun giorno selezionato.</div>';
    el.jobsList.innerHTML = '<div class="empty-state">Nessun job.</div>';
    state.dayPeople = [];
    state.detectedPeopleSuggestions = [];
    renderPeopleEditor();
    return;
  }
  el.dayEditorTitle.textContent = day.title || day.date || 'Giorno';
  el.dayEditorMeta.textContent = `${day.status || 'draft'} · ${day.processing_state || 'idle'}`;
  el.dayDate.value = day.date || '';
  el.dayNumber.value = day.day_number || '';
  el.dayTitle.value = day.title || '';
  el.dayArrivalPlace.value = day.arrival_place || '';
  el.dayCanonicalPath.value = day.canonical_path || '';
  el.dayStravaUrl.value = day.strava_url || '';
  state.dayPeople = uniquePeople(Array.isArray(day.people) ? day.people : []);
  state.detectedPeopleSuggestions = [];
  el.daySummary.value = day.summary || '';
  el.dayNotesWhere.value = day.notes_where || '';
  el.dayNotesScene.value = day.notes_scene || '';
  el.dayNotesSensory.value = day.notes_sensory || '';
  el.dayNotesLearned.value = day.notes_learned || '';
  el.dayNotesPractical.value = day.notes_practical || '';

  const media = Array.isArray(day.media) ? day.media : [];
  el.mediaList.innerHTML = media.length ? media.map((item) => `
    <div class="resource-item">
      ${item.type === 'image' && item.thumb_url ? `<img class="resource-item__thumb" src="${escapeHtml(item.thumb_url)}" alt="${escapeHtml(item.source_filename)}" loading="lazy" />` : ''}
      ${item.type === 'video' && item.poster_url ? `<img class="resource-item__thumb" src="${escapeHtml(item.poster_url)}" alt="${escapeHtml(item.source_filename)}" loading="lazy" />` : ''}
      <strong>${escapeHtml(item.source_filename)}</strong>
      <div class="resource-item__meta">${escapeHtml(item.type)} · ${escapeHtml(item.processing_state)} · ${Number(item.size_bytes || 0)} bytes</div>
      <div class="resource-item__meta">${escapeHtml(item.captured_at || 'captured_at assente')}</div>
      <div class="resource-item__meta">${escapeHtml(item.place_label || 'place assente')}</div>
      ${item.duration_sec ? `<div class="resource-item__meta">durata ${Number(item.duration_sec).toFixed(1)}s</div>` : ''}
      ${item.error_text ? `<div class="resource-item__meta resource-item__meta--error">${escapeHtml(item.error_text)}</div>` : ''}
    </div>
  `).join('') : '<div class="empty-state">Nessun media caricato.</div>';

  const jobs = Array.isArray(day.jobs) ? day.jobs : [];
  el.jobsList.innerHTML = jobs.length ? jobs.map((job) => `
    <div class="resource-item">
      <strong>${escapeHtml(job.job_type)}</strong>
      <div class="resource-item__meta">${escapeHtml(job.status)} · ${escapeHtml(job.created_at || '')}</div>
      ${job.error_text ? `<div class="resource-item__meta resource-item__meta--error">${escapeHtml(job.error_text)}</div>` : ''}
    </div>
  `).join('') : '<div class="empty-state">Nessun job in coda.</div>';
  renderPeopleEditor();
};

const loadProjects = async () => {
  const payload = await apiJson('projects');
  state.projects = Array.isArray(payload.projects) ? payload.projects : [];
  renderProjects();
  if (!state.currentProject && state.projects.length) {
    await loadProject(state.projects[0].id);
  } else if (state.currentProject) {
    const refreshed = state.projects.find((p) => Number(p.id) === Number(state.currentProject.id));
    if (refreshed) {
      state.currentProject = { ...state.currentProject, ...refreshed };
      renderProjectForm();
    }
  }
};

const loadProject = async (projectId) => {
  const payload = await apiJson(`projects/${projectId}`);
  state.currentProject = payload.project || null;
  state.currentDay = null;
  setAuthUi(true);
  renderProjects();
  renderProjectForm();
  await loadDays(projectId);
};

const loadDays = async (projectId) => {
  const payload = await apiJson(`projects/${projectId}/days`);
  state.currentDays = Array.isArray(payload.days) ? payload.days : [];
  renderDays();
  renderDayEditor();
};

const loadDay = async (dayId) => {
  const payload = await apiJson(`days/${dayId}`);
  state.currentDay = payload.day || null;
  renderDays();
  renderDayEditor();
};

const syncAuth = async () => {
  try {
    const payload = await apiJson('me');
    setAuthUi(!!payload.authenticated);
    if (payload.authenticated) {
      await loadProjects();
    }
  } catch (error) {
    setAuthUi(false);
    showStatus(error.message || String(error), true);
  }
};

el.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await apiJson('session/login', 'POST', { password: el.loginPassword.value });
    el.loginPassword.value = '';
    showStatus('Login effettuato.');
    await syncAuth();
  } catch (error) {
    showStatus(error.message || String(error), true);
  }
});

el.logoutBtn.addEventListener('click', async () => {
  try {
    await apiJson('session/logout', 'POST', {});
    state.projects = [];
    state.currentProject = null;
    state.currentDays = [];
    state.currentDay = null;
    renderProjects();
    renderDays();
    renderDayEditor();
    setAuthUi(false);
    showStatus('Sessione chiusa.');
  } catch (error) {
    showStatus(error.message || String(error), true);
  }
});

el.projectCreateForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const payload = await apiJson('projects', 'POST', {
      title: el.projectCreateTitle.value,
      slug: el.projectCreateSlug.value
    });
    el.projectCreateForm.reset();
    showStatus('Progetto creato.');
    await loadProjects();
    if (payload.project && payload.project.id) await loadProject(payload.project.id);
  } catch (error) {
    showStatus(error.message || String(error), true);
  }
});

el.projectForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.currentProject) return;
  try {
    const payload = await apiJson(`projects/${state.currentProject.id}`, 'PATCH', {
      title: el.projectTitle.value,
      slug: el.projectSlug.value,
      subtitle: el.projectSubtitle.value,
      author_name: el.projectAuthorName.value,
      primary_lang: el.projectPrimaryLang.value,
      public_base_path: el.projectPublicBasePath.value,
      intro_text: el.projectIntroText.value
    });
    state.currentProject = payload.project || state.currentProject;
    showStatus('Progetto salvato.');
    await loadProjects();
    renderProjectForm();
  } catch (error) {
    showStatus(error.message || String(error), true);
  }
});

el.projectPreviewBtn.addEventListener('click', () => {
  if (!state.currentProject || !state.currentProject.preview_url) return;
  window.open(state.currentProject.preview_url, '_blank', 'noopener');
});

el.projectPublishBtn.addEventListener('click', async () => {
  if (!state.currentProject) return;
  try {
    const payload = await apiJson(`projects/${state.currentProject.id}/publish`, 'POST', {});
    state.currentProject = payload.project || state.currentProject;
    renderProjectForm();
    await loadProjects();
    showStatus(`Progetto pubblicato. URL: ${payload.project && payload.project.published_url ? payload.project.published_url : ''}`);
  } catch (error) {
    showStatus(error.message || String(error), true);
  }
});

el.dayCreateForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.currentProject) return;
  try {
    const payload = await apiJson(`projects/${state.currentProject.id}/days`, 'POST', {
      date: el.dayCreateDate.value
    });
    el.dayCreateForm.reset();
    showStatus('Giorno creato.');
    await loadDays(state.currentProject.id);
    if (payload.day && payload.day.id) await loadDay(payload.day.id);
  } catch (error) {
    showStatus(error.message || String(error), true);
  }
});

el.dayForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.currentDay) return;
  try {
    const payload = await apiJson(`days/${state.currentDay.id}`, 'PATCH', {
      date: el.dayDate.value,
      day_number: el.dayNumber.value,
      title: el.dayTitle.value,
      arrival_place: el.dayArrivalPlace.value,
      canonical_path: el.dayCanonicalPath.value,
      strava_url: el.dayStravaUrl.value,
      people: uniquePeople(state.dayPeople),
      summary: el.daySummary.value,
      notes_where: el.dayNotesWhere.value,
      notes_scene: el.dayNotesScene.value,
      notes_sensory: el.dayNotesSensory.value,
      notes_learned: el.dayNotesLearned.value,
      notes_practical: el.dayNotesPractical.value
    });
    state.currentDay = payload.day || state.currentDay;
    showStatus('Giorno salvato. Avvio processing del giorno.');
    await processDay(state.currentDay.id);
    if (state.currentProject) await loadDays(state.currentProject.id);
    await loadDay(state.currentDay.id);
  } catch (error) {
    showStatus(error.message || String(error), true);
  }
});

el.dayPeopleAdd.addEventListener('click', () => addDayPerson(el.dayPeopleInput.value));
el.dayPeopleSuggest.addEventListener('click', () => {
  state.detectedPeopleSuggestions = extractPeopleCandidatesFromText(currentDayText());
  renderPeopleEditor();
  if (!state.detectedPeopleSuggestions.length) {
    showStatus('Nessun candidato nome trovato nel testo corrente.');
    return;
  }
  showStatus(`Trovati ${state.detectedPeopleSuggestions.length} candidati dal testo. Clicca i chips per aggiungerli.`);
});
el.dayPeopleInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  addDayPerson(el.dayPeopleInput.value);
});

noteFields().forEach((field) => {
  field.addEventListener('input', () => {
    renderPeoplePreview();
  });
});

el.mediaUploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.currentDay) return;
  const files = el.mediaFiles.files;
  if (!files || !files.length) {
    showStatus('Seleziona almeno un file.', true);
    return;
  }
  try {
    const formData = new FormData();
    Array.from(files).forEach((file) => formData.append('files[]', file));
    const payload = await apiFetch(`days/${state.currentDay.id}/media`, {
      method: 'POST',
      body: formData
    });
    el.mediaUploadForm.reset();
    showStatus(`Caricati ${Number(payload.uploaded_count || 0)} file. Processing media in corso.`);
    await processDay(state.currentDay.id);
    await loadDay(state.currentDay.id);
    if (state.currentProject) await loadDays(state.currentProject.id);
  } catch (error) {
    showStatus(error.message || String(error), true);
  }
});

void syncAuth();

<?php
declare(strict_types=1);
?><!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Diary Studio</title>
  <link rel="stylesheet" href="./assets/studio.css" />
</head>
<body>
  <div class="studio-shell">
    <aside class="studio-sidebar">
      <div class="studio-brand">
        <div class="studio-brand__eyebrow">Studio</div>
        <h1>Diary Studio</h1>
        <p>Area separata per creare diari, giorni e contenuti senza toccare il runtime pubblico.</p>
      </div>

      <section class="card" id="login-card">
        <h2>Login</h2>
        <form id="login-form" class="stack">
          <label>
            <span>Password admin</span>
            <input id="login-password" type="password" autocomplete="current-password" />
          </label>
          <button type="submit" class="btn btn--primary">Accedi</button>
        </form>
      </section>

      <section class="card hidden" id="projects-card">
        <div class="card-head">
          <h2>Progetti</h2>
          <button id="logout-btn" class="btn btn--ghost" type="button">Logout</button>
        </div>
        <div id="projects-list" class="project-list"></div>
        <form id="project-create-form" class="stack top-gap">
          <label>
            <span>Titolo nuovo progetto</span>
            <input id="project-create-title" type="text" placeholder="Diario Andalusia 2026" />
          </label>
          <label>
            <span>Slug</span>
            <input id="project-create-slug" type="text" placeholder="diario-andalusia-2026" />
          </label>
          <button type="submit" class="btn btn--primary">Crea progetto</button>
        </form>
      </section>
    </aside>

    <main class="studio-main">
      <div id="status-banner" class="status-banner hidden"></div>

      <section class="panel hidden" id="project-panel">
        <div class="panel-head">
          <div>
            <div class="panel-kicker">Progetto</div>
            <h2 id="project-panel-title">Seleziona un progetto</h2>
          </div>
          <div id="project-meta" class="project-meta"></div>
        </div>

        <div class="actions-row project-links-row">
          <button id="project-preview-btn" class="btn" type="button">Apri preview</button>
          <button id="project-publish-btn" class="btn btn--primary" type="button">Pubblica progetto</button>
          <a id="project-preview-link" class="inline-link hidden" target="_blank" rel="noopener noreferrer">Preview URL</a>
          <a id="project-published-link" class="inline-link hidden" target="_blank" rel="noopener noreferrer">Published URL</a>
        </div>

        <form id="project-form" class="grid-form">
          <label>
            <span>Titolo</span>
            <input id="project-title" type="text" />
          </label>
          <label>
            <span>Slug</span>
            <input id="project-slug" type="text" />
          </label>
          <label>
            <span>Sottotitolo</span>
            <input id="project-subtitle" type="text" />
          </label>
          <label>
            <span>Autore</span>
            <input id="project-author-name" type="text" />
          </label>
          <label>
            <span>Lingua principale</span>
            <select id="project-primary-lang">
              <option value="it">it</option>
              <option value="en">en</option>
              <option value="es">es</option>
              <option value="fr">fr</option>
            </select>
          </label>
          <label>
            <span>Base path pubblico</span>
            <input id="project-public-base-path" type="text" placeholder="/diario-andalusia-2026" />
          </label>
          <label class="full">
            <span>Intro</span>
            <textarea id="project-intro-text" rows="4"></textarea>
          </label>
          <div class="full actions-row">
            <button type="submit" class="btn btn--primary">Salva progetto</button>
          </div>
        </form>
      </section>

      <section class="panel hidden" id="days-panel">
        <div class="panel-head">
          <div>
            <div class="panel-kicker">Giorni</div>
            <h2>Struttura del diario</h2>
          </div>
        </div>

        <div class="days-layout">
          <div class="card">
            <div class="card-head">
              <h3>Elenco giorni</h3>
            </div>
            <div id="days-list" class="days-list"></div>
            <form id="day-create-form" class="stack top-gap">
              <label>
                <span>Data</span>
                <input id="day-create-date" type="date" />
              </label>
              <button type="submit" class="btn btn--primary">Aggiungi giorno</button>
            </form>
          </div>

          <div class="card" id="day-editor-card">
            <div class="card-head">
              <div>
                <h3 id="day-editor-title">Seleziona un giorno</h3>
                <div id="day-editor-meta" class="muted small"></div>
              </div>
            </div>

            <form id="day-form" class="grid-form">
              <label>
                <span>Data</span>
                <input id="day-date" type="date" />
              </label>
              <label>
                <span>Numero giorno</span>
                <input id="day-number" type="number" min="1" />
              </label>
              <label>
                <span>Titolo</span>
                <input id="day-title" type="text" />
              </label>
              <label>
                <span>Luogo arrivo</span>
                <input id="day-arrival-place" type="text" />
              </label>
              <label class="full">
                <span>Canonical path</span>
                <input id="day-canonical-path" type="text" />
              </label>
              <label class="full">
                <span>Link Strava</span>
                <input id="day-strava-url" type="url" placeholder="https://www.strava.com/activities/..." />
              </label>
              <div class="full">
                <span class="field-label">Persone citate</span>
                <div id="day-people-suggestions" class="chips-row chips-row--suggestions"></div>
                <div id="day-people-chips" class="chips-row"></div>
                <div class="chip-input-row">
                  <input id="day-people-input" type="text" placeholder="Aggiungi un nome e premi invio" />
                  <button id="day-people-add" class="btn" type="button">Aggiungi nome</button>
                  <button id="day-people-suggest" class="btn btn--ghost" type="button">Suggerisci dal testo</button>
                </div>
                <div id="day-people-validation" class="people-validation"></div>
                <div id="day-people-text-preview" class="people-text-preview"></div>
              </div>
              <label class="full">
                <span>Summary</span>
                <textarea id="day-summary" rows="3"></textarea>
              </label>
              <label class="full">
                <span>Dove ero / tappa</span>
                <textarea id="day-notes-where" rows="4"></textarea>
              </label>
              <label class="full">
                <span>Scena chiave</span>
                <textarea id="day-notes-scene" rows="5"></textarea>
              </label>
              <label class="full">
                <span>Dettaglio sensoriale</span>
                <textarea id="day-notes-sensory" rows="3"></textarea>
              </label>
              <label class="full">
                <span>Una cosa che ho capito</span>
                <textarea id="day-notes-learned" rows="3"></textarea>
              </label>
              <label class="full">
                <span>Nota pratica</span>
                <textarea id="day-notes-practical" rows="4"></textarea>
              </label>
              <div class="full actions-row">
                <button type="submit" class="btn btn--primary">Salva bozza</button>
              </div>
            </form>

            <div class="split-block top-gap">
              <div>
                <h4>Media</h4>
                <form id="media-upload-form" class="stack">
                  <input id="media-files" type="file" multiple />
                  <button type="submit" class="btn btn--primary">Carica file</button>
                </form>
                <div id="media-list" class="resource-list top-gap"></div>
              </div>
              <div>
                <h4>Job in coda</h4>
                <div id="jobs-list" class="resource-list"></div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>

  <script src="./assets/studio.js" defer></script>
</body>
</html>

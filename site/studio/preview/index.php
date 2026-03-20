<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/lib/bootstrap.php';
require_once dirname(__DIR__) . '/lib/store.php';

$publicOrigin = 'http://127.0.0.1:4173';
$slug = trim((string)($_GET['project'] ?? ''));
$project = $slug !== '' ? studio_get_project_by_slug($slug) : null;
if (!$project) {
  http_response_code(404);
  echo 'Project not found.';
  exit;
}
$payload = studio_export_entries_payload((int)$project['id']);
$bootstrap = [
  'entriesData' => $payload,
];
function h(string $value): string {
  return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}
?><!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title><?= h($project['title']) ?> — Preview Studio</title>
  <meta id="meta-description" name="description" content="<?= h($project['subtitle'] ?: 'Preview Studio del diario') ?>" />
  <link id="seo-canonical" rel="canonical" href="./?project=<?= rawurlencode($project['slug']) ?>" />
  <link id="seo-alt-it" rel="alternate" hreflang="it" href="./?project=<?= rawurlencode($project['slug']) ?>" />
  <link id="seo-alt-en" rel="alternate" hreflang="en" href="./?project=<?= rawurlencode($project['slug']) ?>" />
  <link id="seo-alt-es" rel="alternate" hreflang="es" href="./?project=<?= rawurlencode($project['slug']) ?>" />
  <link id="seo-alt-fr" rel="alternate" hreflang="fr" href="./?project=<?= rawurlencode($project['slug']) ?>" />
  <link id="seo-alt-default" rel="alternate" hreflang="x-default" href="./?project=<?= rawurlencode($project['slug']) ?>" />
  <link rel="stylesheet" href="<?= h($publicOrigin) ?>/styles.css" />
  <link
    rel="stylesheet"
    href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
    integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
    crossorigin=""
  />
</head>
<body>
  <header class="hero" id="hero">
    <div class="hero__inner">
      <div class="hero__top">
        <div class="hero__title">
          <span class="eyebrow">Preview Studio</span>
          <h1><?= h($project['title']) ?></h1>
          <p class="lead"><?= h($project['subtitle'] ?: 'Diario in preview separata dal sito pubblico') ?></p>
          <?php if ($project['intro_text'] !== ''): ?>
            <p class="hero__intro"><?= nl2br(h($project['intro_text'])) ?></p>
          <?php endif; ?>
        </div>
        <div class="controls">
          <div class="lang-select">
            <label for="lang-select" class="lang-select__label">Lingua</label>
            <select id="lang-select" class="lang-select__input" aria-label="Seleziona lingua">
              <option value="it">🇮🇹 Italiano</option>
              <option value="en">🇬🇧 English</option>
              <option value="es">🇪🇸 Español</option>
              <option value="fr">🇫🇷 Français</option>
            </select>
          </div>
          <div class="manage-tools">
            <a class="map-link" href="/"><?= h('Torna allo Studio') ?></a>
          </div>
        </div>
      </div>
      <div class="hero__stats">
        <div class="stat"><div class="stat__value" id="stat-days">–</div><div class="stat__label">Giorni</div></div>
        <div class="stat"><div class="stat__value" id="stat-photos">–</div><div class="stat__label">Foto</div></div>
        <div class="stat"><div class="stat__value" id="stat-videos">–</div><div class="stat__label">Video</div></div>
      </div>
    </div>
  </header>

  <section class="timeline-nav" aria-label="timeline">
    <div class="timeline-nav__wrap">
      <div class="timeline-nav__inner" id="timeline-nav"></div>
      <div class="timeline-nav__actions" id="timeline-nav-actions"></div>
    </div>
    <div class="timeline-people" id="timeline-people">
      <a class="timeline-people__link" id="timeline-people-link" href="#">Mappa delle persone</a>
      <div class="timeline-people__rail" id="timeline-people-rail"></div>
    </div>
  </section>

  <main class="content" id="content">
    <div class="loading">Sto preparando il diario…</div>
  </main>

  <button class="day-picker-fab" id="day-picker-toggle" type="button">Vai al giorno</button>
  <div class="day-picker-sheet" id="day-picker-sheet" aria-hidden="true">
    <div class="day-picker-sheet__backdrop" id="day-picker-backdrop"></div>
    <div class="day-picker-sheet__panel">
      <div class="day-picker-sheet__head">
        <strong id="day-picker-title">Vai al giorno</strong>
        <button type="button" class="day-picker-sheet__close" id="day-picker-close" aria-label="Chiudi">×</button>
      </div>
      <div class="day-picker-sheet__list" id="day-picker-list"></div>
    </div>
  </div>

  <div class="mini-map" id="mini-map">
    <div class="mini-map__title">
      <span class="mini-map__date" id="mini-map-date"></span>
      <div class="mini-map__actions">
        <a class="mini-map__open" href="#">Apri Mappa</a>
        <button class="mini-map__toggle" id="mini-map-toggle" type="button" aria-label="Minimizza mappa">–</button>
      </div>
    </div>
    <div class="mini-map__body" id="mini-map-body"></div>
  </div>

  <footer class="footer" id="footer">
    <div class="footer__inner">
      <div class="footer__note">Preview renderizzata con lo stesso frontend del diario pubblico, ma su dati Studio separati.</div>
    </div>
  </footer>

  <div class="modal" id="live-modal" aria-hidden="true">
    <div class="modal__backdrop" id="live-modal-backdrop"></div>
    <div class="modal__content">
      <button class="modal__close" id="live-modal-close" aria-label="Close">×</button>
      <div id="live-modal-body"></div>
    </div>
  </div>

  <div class="modal comments-modal" id="comments-modal" aria-hidden="true">
    <div class="modal__backdrop" id="comments-modal-backdrop"></div>
    <div class="modal__content comments-modal__content">
      <button class="modal__close" id="comments-modal-close" aria-label="Close">×</button>
      <h3 class="comments-modal__title" id="comments-modal-title">Commenti</h3>
      <div class="comments__list" id="comments-list"></div>
      <form class="comments__form" id="comments-form">
        <input id="comments-author" type="text" maxlength="80" placeholder="Nome" required />
        <textarea id="comments-text" maxlength="1200" placeholder="Scrivi un commento" required></textarea>
        <button type="submit">Invia</button>
      </form>
    </div>
  </div>

  <script>
    window.__CAMMINO_BOOTSTRAP_DATA__ = <?= json_encode($bootstrap, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?>;
  </script>
  <script
    src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
    integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="
    crossorigin=""
  ></script>
  <script src="<?= h($publicOrigin) ?>/app.js?v=20260304-13"></script>
</body>
</html>

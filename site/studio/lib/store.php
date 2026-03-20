<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

function studio_db(): PDO {
  static $pdo = null;
  if ($pdo instanceof PDO) return $pdo;
  $dbPath = studio_storage_root() . '/studio.sqlite';
  $pdo = new PDO('sqlite:' . $dbPath);
  $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
  $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
  $pdo->exec('PRAGMA foreign_keys = ON');
  studio_bootstrap_schema($pdo);
  return $pdo;
}

function studio_bootstrap_schema(PDO $pdo): void {
  static $booted = false;
  if ($booted) return;
  $pdo->exec("
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      subtitle TEXT NOT NULL DEFAULT '',
      author_name TEXT NOT NULL DEFAULT '',
      primary_lang TEXT NOT NULL DEFAULT 'it',
      public_base_path TEXT NOT NULL DEFAULT '',
      intro_text TEXT NOT NULL DEFAULT '',
      theme_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      day_number INTEGER DEFAULT NULL,
      title TEXT NOT NULL DEFAULT '',
      arrival_place TEXT NOT NULL DEFAULT '',
      canonical_path TEXT NOT NULL DEFAULT '',
      strava_url TEXT NOT NULL DEFAULT '',
      people_json TEXT NOT NULL DEFAULT '[]',
      summary TEXT NOT NULL DEFAULT '',
      notes_where TEXT NOT NULL DEFAULT '',
      notes_scene TEXT NOT NULL DEFAULT '',
      notes_sensory TEXT NOT NULL DEFAULT '',
      notes_learned TEXT NOT NULL DEFAULT '',
      notes_practical TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      processing_state TEXT NOT NULL DEFAULT 'idle',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, date),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS media_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      day_id INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'image',
      source_filename TEXT NOT NULL,
      storage_original_path TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT '',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      processing_state TEXT NOT NULL DEFAULT 'queued',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (day_id) REFERENCES project_days(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      day_id INTEGER NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_url TEXT NOT NULL DEFAULT '',
      storage_source_path TEXT NOT NULL DEFAULT '',
      processing_state TEXT NOT NULL DEFAULT 'idle',
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (day_id) REFERENCES project_days(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      day_id INTEGER DEFAULT NULL,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      payload_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT DEFAULT NULL,
      error_text TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      started_at TEXT DEFAULT NULL,
      finished_at TEXT DEFAULT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (day_id) REFERENCES project_days(id) ON DELETE CASCADE
    );
  ");
  studio_ensure_column($pdo, 'media_items', 'storage_render_path', "TEXT NOT NULL DEFAULT ''");
  studio_ensure_column($pdo, 'media_items', 'storage_thumb_path', "TEXT NOT NULL DEFAULT ''");
  studio_ensure_column($pdo, 'media_items', 'storage_poster_path', "TEXT NOT NULL DEFAULT ''");
  studio_ensure_column($pdo, 'media_items', 'captured_at', "TEXT NOT NULL DEFAULT ''");
  studio_ensure_column($pdo, 'media_items', 'place_label', "TEXT NOT NULL DEFAULT ''");
  studio_ensure_column($pdo, 'media_items', 'lat', "REAL DEFAULT NULL");
  studio_ensure_column($pdo, 'media_items', 'lon', "REAL DEFAULT NULL");
  studio_ensure_column($pdo, 'media_items', 'gps_inferred', "INTEGER NOT NULL DEFAULT 0");
  studio_ensure_column($pdo, 'media_items', 'duration_sec', "REAL DEFAULT NULL");
  studio_ensure_column($pdo, 'media_items', 'error_text', "TEXT NOT NULL DEFAULT ''");
  studio_ensure_column($pdo, 'project_days', 'people_json', "TEXT NOT NULL DEFAULT '[]'");
  $booted = true;
}

function studio_ensure_column(PDO $pdo, string $table, string $column, string $definition): void {
  $stmt = $pdo->query("PRAGMA table_info({$table})");
  $columns = $stmt ? $stmt->fetchAll() : [];
  foreach ($columns as $info) {
    if (isset($info['name']) && (string)$info['name'] === $column) return;
  }
  $pdo->exec("ALTER TABLE {$table} ADD COLUMN {$column} {$definition}");
}

function studio_validate_lang(string $value): string {
  $value = strtolower(trim($value));
  return in_array($value, ['it', 'en', 'es', 'fr'], true) ? $value : 'it';
}

function studio_project_base_path(string $slug, string $candidate): string {
  $candidate = trim($candidate);
  if ($candidate === '') return '/' . $slug;
  return '/' . trim($candidate, '/');
}

function studio_build_day_canonical_path(array $project, string $date, string $current = ''): string {
  $current = trim($current);
  if ($current !== '') return '/' . trim($current, '/');
  $basePath = studio_project_base_path((string)$project['slug'], (string)($project['public_base_path'] ?? ''));
  return rtrim($basePath, '/') . '/day/' . $date . '/';
}

function studio_queue_job(int $projectId, ?int $dayId, string $jobType, array $payload = []): void {
  $pdo = studio_db();
  $stmt = $pdo->prepare("
    INSERT INTO jobs (project_id, day_id, job_type, status, payload_json, created_at)
    VALUES (:project_id, :day_id, :job_type, 'queued', :payload_json, :created_at)
  ");
  $stmt->execute([
    ':project_id' => $projectId,
    ':day_id' => $dayId,
    ':job_type' => $jobType,
    ':payload_json' => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ':created_at' => studio_now(),
  ]);
}

function studio_project_row(array $row): array {
  $slug = (string)$row['slug'];
  $previewUrl = './preview/?project=' . rawurlencode($slug);
  $publishedUrl = ((string)$row['status'] === 'published')
    ? './published/?project=' . rawurlencode($slug)
    : '';
  return [
    'id' => (int)$row['id'],
    'slug' => $slug,
    'title' => (string)$row['title'],
    'subtitle' => (string)$row['subtitle'],
    'author_name' => (string)$row['author_name'],
    'primary_lang' => (string)$row['primary_lang'],
    'public_base_path' => (string)$row['public_base_path'],
    'intro_text' => (string)$row['intro_text'],
    'status' => (string)$row['status'],
    'preview_url' => $previewUrl,
    'published_url' => $publishedUrl,
    'days_count' => isset($row['days_count']) ? (int)$row['days_count'] : 0,
    'created_at' => (string)$row['created_at'],
    'updated_at' => (string)$row['updated_at'],
  ];
}

function studio_get_project_by_slug(string $slug): ?array {
  $pdo = studio_db();
  $stmt = $pdo->prepare("
    SELECT p.*,
      (SELECT COUNT(*) FROM project_days d WHERE d.project_id = p.id) AS days_count
    FROM projects p
    WHERE p.slug = :slug
    LIMIT 1
  ");
  $stmt->execute([':slug' => trim($slug)]);
  $row = $stmt->fetch();
  return $row ? studio_project_row($row) : null;
}

function studio_day_row(array $row, bool $withRelations = false): array {
  $people = json_decode((string)($row['people_json'] ?? '[]'), true);
  if (!is_array($people)) $people = [];
  $people = array_values(array_filter(array_map(static function ($value): string {
    return studio_clean_text((string)$value);
  }, $people), static fn(string $value): bool => $value !== ''));
  $day = [
    'id' => (int)$row['id'],
    'project_id' => (int)$row['project_id'],
    'date' => (string)$row['date'],
    'day_number' => $row['day_number'] !== null ? (int)$row['day_number'] : null,
    'title' => (string)$row['title'],
    'arrival_place' => (string)$row['arrival_place'],
    'canonical_path' => (string)$row['canonical_path'],
    'strava_url' => (string)$row['strava_url'],
    'people' => $people,
    'summary' => (string)$row['summary'],
    'notes_where' => (string)$row['notes_where'],
    'notes_scene' => (string)$row['notes_scene'],
    'notes_sensory' => (string)$row['notes_sensory'],
    'notes_learned' => (string)$row['notes_learned'],
    'notes_practical' => (string)$row['notes_practical'],
    'status' => (string)$row['status'],
    'processing_state' => (string)$row['processing_state'],
    'media_count' => isset($row['media_count']) ? (int)$row['media_count'] : 0,
    'created_at' => (string)$row['created_at'],
    'updated_at' => (string)$row['updated_at'],
  ];
  if ($withRelations) {
    $day['media'] = studio_list_media((int)$row['id']);
    $day['jobs'] = studio_list_jobs_for_day((int)$row['id']);
  }
  return $day;
}

function studio_media_row(array $row): array {
  return [
    'id' => (int)$row['id'],
    'project_id' => (int)$row['project_id'],
    'day_id' => (int)$row['day_id'],
    'type' => (string)$row['type'],
    'source_filename' => (string)$row['source_filename'],
    'storage_original_path' => (string)$row['storage_original_path'],
    'mime_type' => (string)$row['mime_type'],
    'size_bytes' => (int)$row['size_bytes'],
    'sort_order' => (int)$row['sort_order'],
    'processing_state' => (string)$row['processing_state'],
    'storage_render_path' => (string)($row['storage_render_path'] ?? ''),
    'storage_thumb_path' => (string)($row['storage_thumb_path'] ?? ''),
    'storage_poster_path' => (string)($row['storage_poster_path'] ?? ''),
    'captured_at' => (string)($row['captured_at'] ?? ''),
    'place_label' => (string)($row['place_label'] ?? ''),
    'lat' => isset($row['lat']) && $row['lat'] !== null ? (float)$row['lat'] : null,
    'lon' => isset($row['lon']) && $row['lon'] !== null ? (float)$row['lon'] : null,
    'gps_inferred' => !empty($row['gps_inferred']),
    'duration_sec' => isset($row['duration_sec']) && $row['duration_sec'] !== null ? (float)$row['duration_sec'] : null,
    'error_text' => (string)($row['error_text'] ?? ''),
    'metadata_json' => (string)($row['metadata_json'] ?? '{}'),
    'src_url' => studio_media_public_url((int)$row['id'], 'src'),
    'thumb_url' => studio_media_public_url((int)$row['id'], 'thumb'),
    'poster_url' => studio_media_public_url((int)$row['id'], 'poster'),
    'original_url' => studio_media_public_url((int)$row['id'], 'original'),
    'created_at' => (string)$row['created_at'],
    'updated_at' => (string)$row['updated_at'],
  ];
}

function studio_media_public_url(int $mediaId, string $variant = 'original'): string {
  return '/media/?id=' . $mediaId . '&variant=' . rawurlencode($variant);
}

function studio_video_placeholder_poster(): string {
  $svg = <<<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  <rect width="1200" height="675" fill="#e9dfd2"/>
  <circle cx="600" cy="337.5" r="84" fill="#1f5f5b" opacity="0.16"/>
  <polygon points="570,280 570,395 680,337.5" fill="#1f5f5b"/>
  <text x="600" y="470" text-anchor="middle" font-family="Georgia, serif" font-size="34" fill="#5f5448">Video preview in processing</text>
</svg>
SVG;
  return 'data:image/svg+xml;charset=UTF-8,' . rawurlencode($svg);
}

function studio_build_notes_markdown(array $day): string {
  $parts = [];
  $map = [
    'Titolo' => (string)($day['title'] ?? ''),
    'Dove ero / tappa' => (string)($day['notes_where'] ?? ''),
    'Scena chiave' => (string)($day['notes_scene'] ?? ''),
    'Dettaglio sensoriale' => (string)($day['notes_sensory'] ?? ''),
    'Una cosa che ho capito' => (string)($day['notes_learned'] ?? ''),
    'Nota pratica' => (string)($day['notes_practical'] ?? ''),
  ];
  foreach ($map as $heading => $text) {
    $clean = studio_clean_multiline($text);
    if ($clean === '') continue;
    $parts[] = '**' . $heading . '**' . "\n" . $clean;
  }
  return implode("\n\n", $parts);
}

function studio_export_entries_payload(int $projectId): array {
  $project = studio_get_project($projectId);
  if (!$project) throw new RuntimeException('Project not found');
  $days = studio_list_days_with_relations($projectId);
  $images = 0;
  $videos = 0;
  $exportDays = [];
  foreach ($days as $day) {
    $items = [];
    foreach (($day['media'] ?? []) as $media) {
      $isVideo = (string)$media['type'] === 'video';
      if ($isVideo) $videos += 1;
      else $images += 1;
      $capturedAt = trim((string)($media['captured_at'] ?? ''));
      $timeLabel = '';
      if (preg_match('/^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/', $capturedAt, $m)) {
        $timeLabel = $m[1];
      }
      $posterUrl = $isVideo
        ? ((string)($media['storage_poster_path'] ?? '') !== '' ? studio_media_public_url((int)$media['id'], 'poster') : studio_video_placeholder_poster())
        : null;
      $items[] = [
        'id' => 'studio-media-' . (int)$media['id'],
        'type' => $isVideo ? 'video' : 'image',
        'date' => (string)$day['date'],
        'time' => $timeLabel,
        'src' => studio_media_public_url((int)$media['id'], 'src'),
        'thumb' => $isVideo ? null : studio_media_public_url((int)$media['id'], 'thumb'),
        'poster' => $posterUrl,
        'mime' => (string)$media['mime_type'],
        'size' => (int)$media['size_bytes'],
        'orig' => (string)$media['source_filename'],
        'place' => (string)($media['place_label'] ?? ''),
        'lat' => $media['lat'] ?? null,
        'lon' => $media['lon'] ?? null,
        'gpsInferred' => !empty($media['gps_inferred']),
        'durationSec' => $media['duration_sec'] ?? null
      ];
    }
    $exportDays[] = [
      'date' => (string)$day['date'],
      'people' => array_values($day['people'] ?? []),
      'items' => $items,
      'notes' => studio_build_notes_markdown($day),
      'recommendations' => [],
      'strava' => ((string)($day['strava_url'] ?? '') !== '') ? [(string)$day['strava_url']] : []
    ];
  }
  return [
    'generated_at' => studio_now(),
    'days' => $exportDays,
    'counts' => [
      'images' => $images,
      'videos' => $videos,
    ],
    'project' => [
      'title' => $project['title'],
      'subtitle' => $project['subtitle'],
      'author_name' => $project['author_name'],
      'intro_text' => $project['intro_text'],
    ]
  ];
}

function studio_job_row(array $row): array {
  return [
    'id' => (int)$row['id'],
    'job_type' => (string)$row['job_type'],
    'status' => (string)$row['status'],
    'error_text' => $row['error_text'] !== null ? (string)$row['error_text'] : '',
    'created_at' => (string)$row['created_at'],
    'started_at' => $row['started_at'] !== null ? (string)$row['started_at'] : null,
    'finished_at' => $row['finished_at'] !== null ? (string)$row['finished_at'] : null,
  ];
}

function studio_list_projects(): array {
  $pdo = studio_db();
  $stmt = $pdo->query("
    SELECT p.*,
      (SELECT COUNT(*) FROM project_days d WHERE d.project_id = p.id) AS days_count
    FROM projects p
    ORDER BY p.updated_at DESC, p.id DESC
  ");
  return array_map('studio_project_row', $stmt->fetchAll());
}

function studio_get_project(int $projectId): ?array {
  $pdo = studio_db();
  $stmt = $pdo->prepare("
    SELECT p.*,
      (SELECT COUNT(*) FROM project_days d WHERE d.project_id = p.id) AS days_count
    FROM projects p
    WHERE p.id = :id
    LIMIT 1
  ");
  $stmt->execute([':id' => $projectId]);
  $row = $stmt->fetch();
  return $row ? studio_project_row($row) : null;
}

function studio_create_project(array $payload): array {
  $pdo = studio_db();
  $title = studio_clean_text($payload['title'] ?? '');
  if ($title === '') {
    throw new RuntimeException('Titolo progetto obbligatorio');
  }
  $slug = studio_slugify((string)($payload['slug'] ?? ''));
  if ($slug === '') $slug = studio_slugify($title);
  if ($slug === '') {
    throw new RuntimeException('Slug non valido');
  }
  $now = studio_now();
  $stmt = $pdo->prepare("
    INSERT INTO projects (
      slug, title, subtitle, author_name, primary_lang, public_base_path, intro_text, theme_json, status, created_at, updated_at
    ) VALUES (
      :slug, :title, '', '', 'it', :public_base_path, '', '{}', 'draft', :created_at, :updated_at
    )
  ");
  $stmt->execute([
    ':slug' => $slug,
    ':title' => $title,
    ':public_base_path' => '/' . $slug,
    ':created_at' => $now,
    ':updated_at' => $now,
  ]);
  return studio_get_project((int)$pdo->lastInsertId()) ?? throw new RuntimeException('Cannot load created project');
}

function studio_update_project(int $projectId, array $payload): array {
  $pdo = studio_db();
  $project = studio_get_project($projectId);
  if (!$project) throw new RuntimeException('Project not found');
  $title = studio_clean_text($payload['title'] ?? $project['title']);
  if ($title === '') throw new RuntimeException('Titolo progetto obbligatorio');
  $slug = studio_slugify((string)($payload['slug'] ?? $project['slug']));
  if ($slug === '') throw new RuntimeException('Slug non valido');
  $subtitle = studio_clean_text($payload['subtitle'] ?? $project['subtitle']);
  $authorName = studio_clean_text($payload['author_name'] ?? $project['author_name']);
  $primaryLang = studio_validate_lang((string)($payload['primary_lang'] ?? $project['primary_lang']));
  $publicBasePath = studio_project_base_path($slug, (string)($payload['public_base_path'] ?? $project['public_base_path']));
  $introText = studio_clean_multiline($payload['intro_text'] ?? $project['intro_text']);
  $stmt = $pdo->prepare("
    UPDATE projects
    SET slug = :slug,
        title = :title,
        subtitle = :subtitle,
        author_name = :author_name,
        primary_lang = :primary_lang,
        public_base_path = :public_base_path,
        intro_text = :intro_text,
        updated_at = :updated_at
    WHERE id = :id
  ");
  $stmt->execute([
    ':slug' => $slug,
    ':title' => $title,
    ':subtitle' => $subtitle,
    ':author_name' => $authorName,
    ':primary_lang' => $primaryLang,
    ':public_base_path' => $publicBasePath,
    ':intro_text' => $introText,
    ':updated_at' => studio_now(),
    ':id' => $projectId,
  ]);
  return studio_get_project($projectId) ?? throw new RuntimeException('Project not found');
}

function studio_list_days(int $projectId): array {
  $pdo = studio_db();
  $stmt = $pdo->prepare("
    SELECT d.*,
      (SELECT COUNT(*) FROM media_items m WHERE m.day_id = d.id) AS media_count
    FROM project_days d
    WHERE d.project_id = :project_id
    ORDER BY d.date ASC, d.id ASC
  ");
  $stmt->execute([':project_id' => $projectId]);
  return array_map(static fn(array $row): array => studio_day_row($row, false), $stmt->fetchAll());
}

function studio_next_day_number(int $projectId): int {
  $pdo = studio_db();
  $stmt = $pdo->prepare("SELECT COALESCE(MAX(day_number), 0) FROM project_days WHERE project_id = :project_id");
  $stmt->execute([':project_id' => $projectId]);
  return (int)$stmt->fetchColumn() + 1;
}

function studio_create_day(int $projectId, array $payload): array {
  $pdo = studio_db();
  $project = studio_get_project($projectId);
  if (!$project) throw new RuntimeException('Project not found');
  $date = substr(trim((string)($payload['date'] ?? '')), 0, 10);
  if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
    throw new RuntimeException('Data giorno non valida');
  }
  $dayNumber = studio_next_day_number($projectId);
  $canonicalPath = studio_build_day_canonical_path($project, $date);
  $stmt = $pdo->prepare("
    INSERT INTO project_days (
      project_id, date, day_number, title, arrival_place, canonical_path, strava_url, summary,
      notes_where, notes_scene, notes_sensory, notes_learned, notes_practical,
      status, processing_state, created_at, updated_at
    ) VALUES (
      :project_id, :date, :day_number, '', '', :canonical_path, '', '',
      '', '', '', '', '',
      'draft', 'idle', :created_at, :updated_at
    )
  ");
  $now = studio_now();
  $stmt->execute([
    ':project_id' => $projectId,
    ':date' => $date,
    ':day_number' => $dayNumber,
    ':canonical_path' => $canonicalPath,
    ':created_at' => $now,
    ':updated_at' => $now,
  ]);
  return studio_get_day((int)$pdo->lastInsertId(), true) ?? throw new RuntimeException('Cannot load created day');
}

function studio_get_day(int $dayId, bool $withRelations = false): ?array {
  $pdo = studio_db();
  $stmt = $pdo->prepare("
    SELECT d.*,
      (SELECT COUNT(*) FROM media_items m WHERE m.day_id = d.id) AS media_count
    FROM project_days d
    WHERE d.id = :id
    LIMIT 1
  ");
  $stmt->execute([':id' => $dayId]);
  $row = $stmt->fetch();
  return $row ? studio_day_row($row, $withRelations) : null;
}

function studio_update_day(int $dayId, array $payload): array {
  $pdo = studio_db();
  $day = studio_get_day($dayId, false);
  if (!$day) throw new RuntimeException('Day not found');
  $project = studio_get_project((int)$day['project_id']);
  if (!$project) throw new RuntimeException('Project not found');
  $date = substr(trim((string)($payload['date'] ?? $day['date'])), 0, 10);
  if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
    throw new RuntimeException('Data giorno non valida');
  }
  $dayNumberRaw = trim((string)($payload['day_number'] ?? (string)($day['day_number'] ?? '')));
  $dayNumber = $dayNumberRaw !== '' ? (int)$dayNumberRaw : null;
  $title = studio_clean_text($payload['title'] ?? $day['title']);
  $arrivalPlace = studio_clean_text($payload['arrival_place'] ?? $day['arrival_place']);
  $canonicalPath = studio_build_day_canonical_path($project, $date, (string)($payload['canonical_path'] ?? $day['canonical_path']));
  $stravaUrl = trim((string)($payload['strava_url'] ?? $day['strava_url']));
  $peopleRaw = $payload['people'] ?? $day['people'] ?? [];
  $peopleList = is_array($peopleRaw) ? $peopleRaw : preg_split('/,/', (string)$peopleRaw);
  $people = [];
  foreach ($peopleList as $person) {
    $clean = studio_clean_text((string)$person);
    if ($clean === '') continue;
    $people[strtolower($clean)] = $clean;
  }
  $summary = studio_clean_multiline($payload['summary'] ?? $day['summary']);
  $notesWhere = studio_clean_multiline($payload['notes_where'] ?? $day['notes_where']);
  $notesScene = studio_clean_multiline($payload['notes_scene'] ?? $day['notes_scene']);
  $notesSensory = studio_clean_multiline($payload['notes_sensory'] ?? $day['notes_sensory']);
  $notesLearned = studio_clean_multiline($payload['notes_learned'] ?? $day['notes_learned']);
  $notesPractical = studio_clean_multiline($payload['notes_practical'] ?? $day['notes_practical']);

  $stmt = $pdo->prepare("
    UPDATE project_days
    SET date = :date,
        day_number = :day_number,
        title = :title,
        arrival_place = :arrival_place,
        canonical_path = :canonical_path,
        strava_url = :strava_url,
        people_json = :people_json,
        summary = :summary,
        notes_where = :notes_where,
        notes_scene = :notes_scene,
        notes_sensory = :notes_sensory,
        notes_learned = :notes_learned,
        notes_practical = :notes_practical,
        processing_state = 'queued',
        updated_at = :updated_at
    WHERE id = :id
  ");
  $stmt->execute([
    ':date' => $date,
    ':day_number' => $dayNumber,
    ':title' => $title,
    ':arrival_place' => $arrivalPlace,
    ':canonical_path' => $canonicalPath,
    ':strava_url' => $stravaUrl,
    ':people_json' => json_encode(array_values($people), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ':summary' => $summary,
    ':notes_where' => $notesWhere,
    ':notes_scene' => $notesScene,
    ':notes_sensory' => $notesSensory,
    ':notes_learned' => $notesLearned,
    ':notes_practical' => $notesPractical,
    ':updated_at' => studio_now(),
    ':id' => $dayId,
  ]);
  studio_queue_job((int)$day['project_id'], $dayId, 'prepare_day', ['day_id' => $dayId, 'trigger' => 'manual_save']);
  return studio_get_day($dayId, true) ?? throw new RuntimeException('Day not found');
}

function studio_list_media(int $dayId): array {
  $pdo = studio_db();
  $stmt = $pdo->prepare("
    SELECT * FROM media_items
    WHERE day_id = :day_id
    ORDER BY sort_order ASC, id ASC
  ");
  $stmt->execute([':day_id' => $dayId]);
  return array_map('studio_media_row', $stmt->fetchAll());
}

function studio_list_jobs_for_day(int $dayId): array {
  $pdo = studio_db();
  $stmt = $pdo->prepare("
    SELECT * FROM jobs
    WHERE day_id = :day_id
    ORDER BY id DESC
    LIMIT 20
  ");
  $stmt->execute([':day_id' => $dayId]);
  return array_map('studio_job_row', $stmt->fetchAll());
}

function studio_uploaded_files(array $files): array {
  $out = [];
  $names = $files['files']['name'] ?? null;
  if (!is_array($names)) return [];
  foreach ($names as $index => $name) {
    $tmpName = $files['files']['tmp_name'][$index] ?? '';
    $error = (int)($files['files']['error'][$index] ?? UPLOAD_ERR_NO_FILE);
    if ($error !== UPLOAD_ERR_OK || !is_uploaded_file($tmpName)) continue;
    $out[] = [
      'name' => (string)$name,
      'type' => (string)($files['files']['type'][$index] ?? ''),
      'tmp_name' => (string)$tmpName,
      'size' => (int)($files['files']['size'][$index] ?? 0),
    ];
  }
  return $out;
}

function studio_store_uploaded_media(int $dayId, array $files): array {
  $pdo = studio_db();
  $day = studio_get_day($dayId, false);
  if (!$day) throw new RuntimeException('Day not found');
  $project = studio_get_project((int)$day['project_id']);
  if (!$project) throw new RuntimeException('Project not found');
  $items = studio_uploaded_files($files);
  if (!$items) throw new RuntimeException('Nessun file valido ricevuto');
  $uploadDir = studio_storage_root() . '/uploads/project-' . (int)$project['id'] . '/day-' . $dayId;
  if (!is_dir($uploadDir)) mkdir($uploadDir, 0775, true);
  $maxSort = (int)$pdo->query("SELECT COALESCE(MAX(sort_order), 0) FROM media_items WHERE day_id = " . (int)$dayId)->fetchColumn();
  $insert = $pdo->prepare("
    INSERT INTO media_items (
      project_id, day_id, type, source_filename, storage_original_path, mime_type, size_bytes, sort_order, processing_state, metadata_json, created_at, updated_at
    ) VALUES (
      :project_id, :day_id, :type, :source_filename, :storage_original_path, :mime_type, :size_bytes, :sort_order, 'queued', '{}', :created_at, :updated_at
    )
  ");
  $uploadedCount = 0;
  foreach ($items as $offset => $file) {
    $safeName = studio_safe_filename((string)$file['name']);
    $storedName = gmdate('YmdHis') . '-' . bin2hex(random_bytes(4)) . '-' . $safeName;
    $destination = $uploadDir . '/' . $storedName;
    if (!move_uploaded_file((string)$file['tmp_name'], $destination)) {
      throw new RuntimeException('Impossibile salvare il file uploadato');
    }
    $mime = trim((string)$file['type']);
    $kind = str_starts_with($mime, 'video/') ? 'video' : 'image';
    $insert->execute([
      ':project_id' => (int)$project['id'],
      ':day_id' => $dayId,
      ':type' => $kind,
      ':source_filename' => (string)$file['name'],
      ':storage_original_path' => $destination,
      ':mime_type' => $mime,
      ':size_bytes' => (int)$file['size'],
      ':sort_order' => $maxSort + $offset + 1,
      ':created_at' => studio_now(),
      ':updated_at' => studio_now(),
    ]);
    $uploadedCount++;
  }
  $pdo->prepare("UPDATE project_days SET processing_state = 'queued', updated_at = :updated_at WHERE id = :id")
    ->execute([':updated_at' => studio_now(), ':id' => $dayId]);
  studio_queue_job((int)$project['id'], $dayId, 'process_media_uploads', ['day_id' => $dayId, 'uploaded_count' => $uploadedCount]);
  return [
    'ok' => true,
    'uploaded_count' => $uploadedCount,
    'day' => studio_get_day($dayId, true),
  ];
}

function studio_publish_project(int $projectId): array {
  $pdo = studio_db();
  $project = studio_get_project($projectId);
  if (!$project) throw new RuntimeException('Project not found');
  $stmt = $pdo->prepare("UPDATE projects SET status = 'published', updated_at = :updated_at WHERE id = :id");
  $stmt->execute([
    ':updated_at' => studio_now(),
    ':id' => $projectId,
  ]);
  studio_queue_job($projectId, null, 'publish_project', ['project_id' => $projectId]);
  return studio_get_project($projectId) ?? throw new RuntimeException('Project not found');
}

function studio_list_days_with_relations(int $projectId): array {
  $days = studio_list_days($projectId);
  return array_map(static function (array $day): array {
    return studio_get_day((int)$day['id'], true) ?? $day;
  }, $days);
}

<?php
declare(strict_types=1);

session_start();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}

function respond(int $status, array $payload): void {
  http_response_code($status);
  echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

function get_path_after_api(): string {
  $uriPath = parse_url($_SERVER['REQUEST_URI'] ?? '/api', PHP_URL_PATH);
  $path = (string)$uriPath;
  $prefix = '/api';
  if (stripos($path, $prefix) === 0) {
    $path = substr($path, strlen($prefix));
  }
  $path = '/' . ltrim($path, '/');
  if ($path === '//') $path = '/';
  return $path;
}

function read_json_body(): array {
  $raw = file_get_contents('php://input');
  if ($raw === false || trim($raw) === '') return [];
  $decoded = json_decode($raw, true);
  return is_array($decoded) ? $decoded : [];
}

function load_env_file(): array {
  static $cache = null;
  if (is_array($cache)) return $cache;
  $cache = [];
  $path = dirname(__DIR__) . '/.env';
  if (!is_file($path)) return $cache;
  $raw = file_get_contents($path);
  if ($raw === false) return $cache;
  $lines = preg_split('/\r\n|\r|\n/', $raw) ?: [];
  foreach ($lines as $line) {
    $line = trim($line);
    if ($line === '' || str_starts_with($line, '#')) continue;
    $pos = strpos($line, '=');
    if ($pos === false) continue;
    $key = trim(substr($line, 0, $pos));
    $val = trim(substr($line, $pos + 1));
    if ($key === '') continue;
    if ((str_starts_with($val, '"') && str_ends_with($val, '"')) || (str_starts_with($val, "'") && str_ends_with($val, "'"))) {
      $val = substr($val, 1, -1);
    }
    $cache[$key] = $val;
  }
  return $cache;
}

function env_value(string $key): ?string {
  $value = getenv($key);
  if ($value !== false && $value !== '') return (string)$value;
  $envFile = load_env_file();
  if (isset($envFile[$key]) && trim((string)$envFile[$key]) !== '') {
    return (string)$envFile[$key];
  }
  return null;
}

function admin_token(): string {
  $candidates = ['COMMENTS_ADMIN_TOKEN', 'CAMMINO_ADMIN_TOKEN', 'ADMIN_TOKEN'];
  foreach ($candidates as $key) {
    $value = env_value($key);
    if ($value !== null) return trim($value);
  }
  return '';
}

function is_admin_authenticated(): bool {
  return !empty($_SESSION['cammino_admin_authenticated']) && $_SESSION['cammino_admin_authenticated'] === true;
}

function require_admin_auth(): void {
  if (!is_admin_authenticated()) {
    respond(401, ['error' => 'Unauthorized']);
  }
}

function normalize_target(string $target): string {
  $value = trim($target);
  if ($value === '') return '';
  if (!preg_match('/^(note|media)-[A-Za-z0-9._:-]+$/', $value)) return '';
  return $value;
}

function comments_store_path(): string {
  return dirname(__DIR__) . '/data/comments.json';
}

function load_store(): array {
  $path = comments_store_path();
  if (!is_file($path)) {
    return ['version' => 1, 'comments' => []];
  }
  $raw = file_get_contents($path);
  if ($raw === false || trim($raw) === '') {
    return ['version' => 1, 'comments' => []];
  }
  $decoded = json_decode($raw, true);
  if (!is_array($decoded)) return ['version' => 1, 'comments' => []];
  if (!isset($decoded['comments']) || !is_array($decoded['comments'])) $decoded['comments'] = [];
  if (!isset($decoded['version'])) $decoded['version'] = 1;
  return $decoded;
}

function save_store(array $store): void {
  $path = comments_store_path();
  $dir = dirname($path);
  if (!is_dir($dir)) {
    if (!mkdir($dir, 0775, true) && !is_dir($dir)) {
      throw new RuntimeException('Cannot create data directory');
    }
  }
  $json = json_encode($store, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  if ($json === false) {
    throw new RuntimeException('Cannot encode comments data');
  }
  $tmp = $path . '.tmp';
  if (file_put_contents($tmp, $json . PHP_EOL, LOCK_EX) === false) {
    throw new RuntimeException('Cannot write temporary comments file');
  }
  if (!rename($tmp, $path)) {
    @unlink($tmp);
    throw new RuntimeException('Cannot persist comments file');
  }
}

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$path = get_path_after_api();

if ($path === '/admin/session') {
  if ($method === 'GET') {
    respond(200, ['authenticated' => is_admin_authenticated()]);
  }
  if ($method === 'POST') {
    $payload = read_json_body();
    $token = trim((string)($payload['token'] ?? ''));
    $configured = admin_token();
    if ($configured === '') {
      respond(500, ['authenticated' => false, 'error' => 'Admin token non configurato']);
    }
    if ($token !== '' && hash_equals($configured, $token)) {
      $_SESSION['cammino_admin_authenticated'] = true;
      $_SESSION['cammino_admin_login_at'] = gmdate('c');
      respond(200, ['authenticated' => true]);
    }
    $_SESSION['cammino_admin_authenticated'] = false;
    respond(401, ['authenticated' => false, 'error' => 'Token non valido']);
  }
  respond(405, ['error' => 'Method not allowed']);
}

if ($path === '/admin/logout') {
  if ($method !== 'POST') respond(405, ['error' => 'Method not allowed']);
  $_SESSION = [];
  if (ini_get('session.use_cookies')) {
    $params = session_get_cookie_params();
    setcookie(session_name(), '', time() - 42000, $params['path'] ?? '/', $params['domain'] ?? '', (bool)($params['secure'] ?? false), (bool)($params['httponly'] ?? true));
  }
  session_destroy();
  respond(200, ['ok' => true, 'authenticated' => false]);
}

if ($path === '/admin/comments') {
  if ($method !== 'GET') respond(405, ['error' => 'Method not allowed']);
  require_admin_auth();

  $target = normalize_target((string)($_GET['target'] ?? ''));
  $q = trim((string)($_GET['q'] ?? ''));
  $qLower = mb_strtolower($q);
  $limitRaw = (int)($_GET['limit'] ?? 1000);
  $limit = max(1, min(5000, $limitRaw));

  $store = load_store();
  $all = [];
  foreach ($store['comments'] as $comment) {
    if (!is_array($comment)) continue;
    $id = (string)($comment['id'] ?? '');
    $t = normalize_target((string)($comment['target'] ?? ''));
    $author = (string)($comment['author'] ?? '');
    $text = (string)($comment['text'] ?? '');
    $createdAt = (string)($comment['created_at'] ?? '');
    if ($id === '' || $t === '') continue;
    $all[] = [
      'id' => $id,
      'target' => $t,
      'author' => $author,
      'text' => $text,
      'created_at' => $createdAt,
    ];
  }

  $countsByTarget = [];
  foreach ($all as $comment) {
    $t = (string)$comment['target'];
    $countsByTarget[$t] = ($countsByTarget[$t] ?? 0) + 1;
  }
  ksort($countsByTarget);

  $filtered = [];
  foreach ($all as $comment) {
    if ($target !== '' && (string)$comment['target'] !== $target) continue;
    if ($qLower !== '') {
      $haystack = mb_strtolower(
        implode(' ', [
          (string)$comment['author'],
          (string)$comment['text'],
          (string)$comment['target'],
          (string)$comment['id'],
        ])
      );
      if (!str_contains($haystack, $qLower)) continue;
    }
    $filtered[] = $comment;
  }

  usort($filtered, static function (array $a, array $b): int {
    return strcmp((string)$b['created_at'], (string)$a['created_at']);
  });
  if (count($filtered) > $limit) {
    $filtered = array_slice($filtered, 0, $limit);
  }

  respond(200, [
    'total' => count($filtered),
    'counts_by_target' => $countsByTarget,
    'comments' => $filtered,
  ]);
}

if ($path === '/admin/comments/delete') {
  if ($method !== 'POST') respond(405, ['error' => 'Method not allowed']);
  require_admin_auth();
  $payload = read_json_body();
  $id = trim((string)($payload['id'] ?? ''));
  if ($id === '') respond(400, ['error' => 'Invalid id']);

  $store = load_store();
  $initial = count($store['comments']);
  $store['comments'] = array_values(array_filter($store['comments'], static function ($comment) use ($id): bool {
    if (!is_array($comment)) return true;
    return (string)($comment['id'] ?? '') !== $id;
  }));
  $removed = $initial - count($store['comments']);
  if ($removed <= 0) respond(404, ['error' => 'Comment not found']);

  try {
    save_store($store);
  } catch (Throwable $e) {
    respond(500, ['error' => 'Cannot persist comments file']);
  }
  respond(200, ['ok' => true, 'removed' => $removed]);
}

if ($path === '/delete') {
  respond(501, ['error' => 'Delete endpoint not enabled on PHP static deploy']);
}

if ($path === '/comments/counts') {
  if ($method !== 'GET' && $method !== 'POST') respond(405, ['error' => 'Method not allowed']);
  $targets = [];
  if ($method === 'POST') {
    $payload = read_json_body();
    if (isset($payload['targets']) && is_array($payload['targets'])) {
      $targets = array_values(array_map(static fn($v) => trim((string)$v), $payload['targets']));
    } else {
      $targetsRaw = (string)($payload['targets'] ?? '');
      $targets = array_values(array_filter(array_map('trim', explode(',', $targetsRaw))));
    }
  } else {
    $targetsRaw = (string)($_GET['targets'] ?? '');
    $targets = array_values(array_filter(array_map('trim', explode(',', $targetsRaw))));
  }
  $targets = array_values(array_unique(array_filter(array_map('normalize_target', $targets))));
  $store = load_store();
  $counts = [];
  foreach ($targets as $t) $counts[$t] = 0;
  foreach ($store['comments'] as $comment) {
    if (!is_array($comment)) continue;
    $target = normalize_target((string)($comment['target'] ?? ''));
    if ($target === '' || !array_key_exists($target, $counts)) continue;
    $counts[$target] += 1;
  }
  respond(200, ['counts' => $counts]);
}

if ($path === '/comments') {
  if ($method === 'GET') {
    $target = normalize_target((string)($_GET['target'] ?? ''));
    if ($target === '') respond(400, ['error' => 'Invalid target']);
    $store = load_store();
    $out = [];
    foreach ($store['comments'] as $comment) {
      if (!is_array($comment)) continue;
      if (normalize_target((string)($comment['target'] ?? '')) !== $target) continue;
      $out[] = [
        'id' => (string)($comment['id'] ?? ''),
        'target' => $target,
        'author' => (string)($comment['author'] ?? ''),
        'text' => (string)($comment['text'] ?? ''),
        'created_at' => (string)($comment['created_at'] ?? ''),
      ];
    }
    usort($out, static function (array $a, array $b): int {
      return strcmp((string)$a['created_at'], (string)$b['created_at']);
    });
    respond(200, ['comments' => $out]);
  }

  if ($method === 'POST') {
    $payload = read_json_body();
    $target = normalize_target((string)($payload['target'] ?? ''));
    $author = trim((string)($payload['author'] ?? ''));
    $text = trim((string)($payload['text'] ?? ''));
    if ($target === '') respond(400, ['error' => 'Invalid target']);
    if ($author === '' || mb_strlen($author) > 80) respond(400, ['error' => 'Invalid author']);
    if ($text === '' || mb_strlen($text) > 1200) respond(400, ['error' => 'Invalid text']);

    $record = [
      'id' => bin2hex(random_bytes(8)),
      'target' => $target,
      'author' => $author,
      'text' => $text,
      'created_at' => gmdate('c'),
    ];
    $store = load_store();
    $store['comments'][] = $record;
    try {
      save_store($store);
    } catch (Throwable $e) {
      respond(500, ['error' => 'Cannot persist comment']);
    }
    respond(201, ['ok' => true, 'comment' => $record]);
  }

  respond(405, ['error' => 'Method not allowed']);
}

respond(404, ['error' => 'Not found']);

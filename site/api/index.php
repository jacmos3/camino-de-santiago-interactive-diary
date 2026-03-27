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

function api_debug_enabled(): bool {
  $value = env_value('API_DEBUG');
  if ($value === null) return false;
  $v = strtolower(trim($value));
  return in_array($v, ['1', 'true', 'yes', 'on'], true);
}

function api_log_path(): string {
  return __DIR__ . '/logs/api_error.log';
}

function api_log_error(string $where, Throwable $e, array $context = []): void {
  try {
    $path = api_log_path();
    $dir = dirname($path);
    if (!is_dir($dir)) {
      @mkdir($dir, 0775, true);
    }
    $entry = [
      'time' => gmdate('c'),
      'where' => $where,
      'error' => $e->getMessage(),
      'file' => $e->getFile(),
      'line' => $e->getLine(),
      'context' => $context,
    ];
    @file_put_contents($path, json_encode($entry, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL, FILE_APPEND | LOCK_EX);
  } catch (Throwable $ignore) {
    // no-op
  }
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

function admin_auth_store_path(): string {
  return dirname(__DIR__) . '/data/admin_auth.json';
}

function load_admin_auth_store(): array {
  $path = admin_auth_store_path();
  if (!is_file($path)) return [];
  $raw = file_get_contents($path);
  if ($raw === false || trim($raw) === '') return [];
  $decoded = json_decode($raw, true);
  return is_array($decoded) ? $decoded : [];
}

function save_admin_auth_store(array $payload): void {
  $path = admin_auth_store_path();
  $dir = dirname($path);
  if (!is_dir($dir)) {
    if (!mkdir($dir, 0775, true) && !is_dir($dir)) {
      throw new RuntimeException('Cannot create data directory');
    }
  }
  $json = json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  if ($json === false) {
    throw new RuntimeException('Cannot encode admin auth payload');
  }
  $tmp = $path . '.tmp';
  if (file_put_contents($tmp, $json . PHP_EOL, LOCK_EX) === false) {
    throw new RuntimeException('Cannot write temporary admin auth file');
  }
  if (!rename($tmp, $path)) {
    @unlink($tmp);
    throw new RuntimeException('Cannot persist admin auth file');
  }
}

function admin_password_hash(): string {
  $store = load_admin_auth_store();
  $hash = trim((string)($store['password_hash'] ?? ''));
  return $hash;
}

function admin_build_password_hash(string $secret): string {
  $salt = bin2hex(random_bytes(16));
  $iterations = 120000;
  $derived = hash_pbkdf2('sha256', $secret, $salt, $iterations, 32, false);
  return "pbkdf2_sha256:{$iterations}:{$salt}:{$derived}";
}

function admin_verify_password_hash(string $secret, string $hash): bool {
  $raw = trim($hash);
  if ($raw === '') return false;
  if (str_starts_with($raw, 'pbkdf2_sha256:')) {
    $parts = explode(':', $raw, 4);
    if (count($parts) !== 4) return false;
    [, $iterationsRaw, $salt, $expected] = $parts;
    $iterations = max(1, (int)$iterationsRaw);
    $computed = hash_pbkdf2('sha256', $secret, $salt, $iterations, 32, false);
    return hash_equals($expected, $computed);
  }
  return password_verify($secret, $raw);
}

function verify_admin_secret(string $secret): bool {
  $secret = trim($secret);
  if ($secret === '') return false;
  $hash = admin_password_hash();
  if ($hash !== '') {
    return admin_verify_password_hash($secret, $hash);
  }
  $fallback = admin_token();
  return $fallback !== '' && hash_equals($fallback, $secret);
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

function ui_flags_store_path(): string {
  return dirname(__DIR__) . '/data/ui_flags.json';
}

function day_og_overrides_store_path(): string {
  return dirname(__DIR__) . '/data/day_og_overrides.json';
}

function default_ui_flags(): array {
  return [
    'show_footer_template_cta' => true,
  ];
}

function normalize_ui_flags(array $raw): array {
  $defaults = default_ui_flags();
  return [
    'show_footer_template_cta' => array_key_exists('show_footer_template_cta', $raw)
      ? (bool)$raw['show_footer_template_cta']
      : (bool)$defaults['show_footer_template_cta'],
  ];
}

function load_ui_flags(): array {
  $path = ui_flags_store_path();
  if (!is_file($path)) return default_ui_flags();
  $raw = file_get_contents($path);
  if ($raw === false || trim($raw) === '') return default_ui_flags();
  $decoded = json_decode($raw, true);
  if (!is_array($decoded)) return default_ui_flags();
  return normalize_ui_flags($decoded);
}

function save_ui_flags(array $flags): void {
  $path = ui_flags_store_path();
  $dir = dirname($path);
  if (!is_dir($dir)) {
    if (!mkdir($dir, 0775, true) && !is_dir($dir)) {
      throw new RuntimeException('Cannot create data directory');
    }
  }
  $normalized = normalize_ui_flags($flags);
  $json = json_encode($normalized, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  if ($json === false) {
    throw new RuntimeException('Cannot encode ui flags');
  }
  $tmp = $path . '.tmp';
  if (file_put_contents($tmp, $json . PHP_EOL, LOCK_EX) === false) {
    throw new RuntimeException('Cannot write temporary ui flags file');
  }
  if (!rename($tmp, $path)) {
    @unlink($tmp);
    throw new RuntimeException('Cannot persist ui flags file');
  }
}

function normalize_day_og_overrides(array $raw): array {
  $normalized = [];
  foreach ($raw as $day => $value) {
    $key = substr(trim((string)$day), 0, 10);
    $mediaId = trim((string)$value);
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $key) && $mediaId !== '') {
      $normalized[$key] = $mediaId;
    }
  }
  ksort($normalized);
  return $normalized;
}

function load_day_og_overrides(): array {
  $path = day_og_overrides_store_path();
  if (!is_file($path)) return [];
  $raw = file_get_contents($path);
  if ($raw === false || trim($raw) === '') return [];
  $decoded = json_decode($raw, true);
  if (!is_array($decoded)) return [];
  return normalize_day_og_overrides($decoded);
}

function save_day_og_overrides(array $overrides): void {
  $path = day_og_overrides_store_path();
  $dir = dirname($path);
  if (!is_dir($dir)) {
    if (!mkdir($dir, 0775, true) && !is_dir($dir)) {
      throw new RuntimeException('Cannot create data directory');
    }
  }
  $normalized = normalize_day_og_overrides($overrides);
  $json = json_encode($normalized, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  if ($json === false) {
    throw new RuntimeException('Cannot encode day og overrides');
  }
  $tmp = $path . '.tmp';
  if (file_put_contents($tmp, $json . PHP_EOL, LOCK_EX) === false) {
    throw new RuntimeException('Cannot write temporary day og overrides file');
  }
  if (!rename($tmp, $path)) {
    @unlink($tmp);
    throw new RuntimeException('Cannot persist day og overrides file');
  }
}

function analytics_enabled(): bool {
  $value = env_value('ANALYTICS_ENABLED');
  if ($value === null) return true;
  $v = strtolower(trim($value));
  if ($v === '' || $v === '1' || $v === 'true' || $v === 'yes' || $v === 'on') return true;
  return false;
}

function analytics_mysql_host(): string { return trim((string)(env_value('ANALYTICS_MYSQL_HOST') ?? '')); }
function analytics_mysql_port(): int { return max(1, min(65535, (int)(env_value('ANALYTICS_MYSQL_PORT') ?? '3306'))); }
function analytics_mysql_db(): string { return trim((string)(env_value('ANALYTICS_MYSQL_DB') ?? '')); }
function analytics_mysql_user(): string { return trim((string)(env_value('ANALYTICS_MYSQL_USER') ?? '')); }
function analytics_mysql_pass(): string { return (string)(env_value('ANALYTICS_MYSQL_PASS') ?? ''); }
function analytics_store_raw_ip(): bool {
  $value = env_value('ANALYTICS_STORE_RAW_IP');
  if ($value === null) return false;
  $v = strtolower(trim($value));
  return in_array($v, ['1', 'true', 'yes', 'on'], true);
}
function analytics_store_raw_ua(): bool {
  $value = env_value('ANALYTICS_STORE_RAW_UA');
  if ($value === null) return false;
  $v = strtolower(trim($value));
  return in_array($v, ['1', 'true', 'yes', 'on'], true);
}

function analytics_secret_salt(): string {
  $salt = env_value('ANALYTICS_SALT');
  if ($salt !== null && trim($salt) !== '') return trim($salt);
  $fallback = admin_token();
  if ($fallback !== '') return $fallback;
  return 'cammino-analytics-salt';
}

function analytics_hash(?string $value): string {
  $v = trim((string)$value);
  if ($v === '') return '';
  return hash('sha256', analytics_secret_salt() . '|' . $v);
}

function analytics_pdo(): PDO {
  static $pdo = null;
  if ($pdo instanceof PDO) return $pdo;
  $host = analytics_mysql_host();
  $port = analytics_mysql_port();
  $db = analytics_mysql_db();
  $user = analytics_mysql_user();
  $pass = analytics_mysql_pass();
  if ($host === '' || $db === '' || $user === '') {
    throw new RuntimeException('Analytics MySQL config missing (ANALYTICS_MYSQL_HOST/DB/USER)');
  }
  $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $host, $port, $db);
  $pdo = new PDO($dsn, $user, $pass, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES => false,
  ]);
  $pdo->exec("
    CREATE TABLE IF NOT EXISTS analytics_events (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      created_at DATETIME NOT NULL,
      cid VARCHAR(64) NOT NULL,
      session_id VARCHAR(64) NOT NULL,
      event_type VARCHAR(60) NOT NULL,
      path VARCHAR(300) NULL,
      lang VARCHAR(8) NULL,
      day_key VARCHAR(10) NULL,
      media_id VARCHAR(80) NULL,
      target_id VARCHAR(80) NULL,
      referrer_host VARCHAR(120) NULL,
      ip_raw VARCHAR(64) NULL,
      user_agent_raw TEXT NULL,
      user_agent_hash CHAR(64) NULL,
      ip_hash CHAR(64) NULL,
      metadata_json JSON NULL,
      INDEX idx_analytics_created_at (created_at),
      INDEX idx_analytics_event_type (event_type),
      INDEX idx_analytics_day_key (day_key),
      INDEX idx_analytics_media_id (media_id),
      INDEX idx_analytics_lang (lang),
      INDEX idx_analytics_cid (cid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  ");
  try { $pdo->exec("ALTER TABLE analytics_events ADD COLUMN ip_raw VARCHAR(64) NULL"); } catch (Throwable $e) {}
  try { $pdo->exec("ALTER TABLE analytics_events ADD COLUMN user_agent_raw TEXT NULL"); } catch (Throwable $e) {}
  try {
    $pdo->exec("ALTER TABLE analytics_events MODIFY metadata_json JSON NULL");
  } catch (Throwable $e) {
    // MySQL/MariaDB variant without native JSON support: keep existing type
  }
  return $pdo;
}

function analytics_string(mixed $value, int $maxLen = 255): string {
  $v = trim((string)$value);
  if ($v === '') return '';
  if (mb_strlen($v) > $maxLen) return mb_substr($v, 0, $maxLen);
  return $v;
}

function analytics_normalize_day_key(mixed $value): string {
  $v = analytics_string($value, 10);
  return preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) ? $v : '';
}

function analytics_normalize_event_type(mixed $value): string {
  $v = analytics_string($value, 60);
  return preg_match('/^[a-z0-9._:-]{2,60}$/i', $v) ? strtolower($v) : '';
}

function analytics_normalize_lang(mixed $value): string {
  $v = analytics_string($value, 8);
  return preg_match('/^[a-z]{2,8}$/i', $v) ? strtolower($v) : '';
}

function analytics_normalize_group_by(mixed $value): string {
  $v = strtolower(analytics_string($value, 16));
  return $v === 'month' ? 'month' : 'day';
}

function analytics_normalize_date(mixed $value): string {
  $v = analytics_string($value, 10);
  return preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) ? $v : '';
}

function analytics_parse_overview_filters(): array {
  $utc = new DateTimeZone('UTC');
  $days = max(1, min(365, (int)($_GET['days'] ?? 30)));
  $fromRaw = analytics_normalize_date($_GET['from'] ?? '');
  $toRaw = analytics_normalize_date($_GET['to'] ?? '');
  $today = new DateTimeImmutable('today', $utc);

  $fromDate = $fromRaw !== '' ? new DateTimeImmutable($fromRaw, $utc) : null;
  $toDate = $toRaw !== '' ? new DateTimeImmutable($toRaw, $utc) : null;

  if (!$fromDate && !$toDate) {
    $toDate = $today;
    $fromDate = $today->sub(new DateInterval('P' . max(0, $days - 1) . 'D'));
  } elseif ($fromDate && !$toDate) {
    $toDate = $fromDate->add(new DateInterval('P' . max(0, $days - 1) . 'D'));
  } elseif (!$fromDate && $toDate) {
    $fromDate = $toDate->sub(new DateInterval('P' . max(0, $days - 1) . 'D'));
  }

  if (!$fromDate || !$toDate) {
    $toDate = $today;
    $fromDate = $today->sub(new DateInterval('P29D'));
  }

  if ($fromDate > $toDate) {
    [$fromDate, $toDate] = [$toDate, $fromDate];
  }

  $periodDays = ((int)$fromDate->diff($toDate)->format('%a')) + 1;

  return [
    'days' => $days,
    'from' => $fromDate->format('Y-m-d'),
    'to' => $toDate->format('Y-m-d'),
    'from_ts' => $fromDate->format('Y-m-d 00:00:00'),
    'to_ts' => $toDate->add(new DateInterval('P1D'))->format('Y-m-d 00:00:00'),
    'period_days' => $periodDays,
    'group_by' => analytics_normalize_group_by($_GET['group_by'] ?? ''),
    'lang' => analytics_normalize_lang($_GET['lang'] ?? ''),
    'path' => analytics_string($_GET['path'] ?? '', 300),
    'day_key' => analytics_normalize_day_key($_GET['day_key'] ?? ''),
  ];
}

function analytics_build_where(array $filters, array &$params, bool $includePath = true, bool $includeDayKey = true): string {
  $clauses = [
    'created_at >= :from_ts',
    'created_at < :to_ts',
  ];
  $params[':from_ts'] = (string)$filters['from_ts'];
  $params[':to_ts'] = (string)$filters['to_ts'];

  $lang = (string)($filters['lang'] ?? '');
  if ($lang !== '') {
    $clauses[] = 'lang = :lang';
    $params[':lang'] = $lang;
  }

  if ($includePath) {
    $path = (string)($filters['path'] ?? '');
    if ($path !== '') {
      $clauses[] = 'path = :path';
      $params[':path'] = $path;
    }
  }

  if ($includeDayKey) {
    $dayKey = (string)($filters['day_key'] ?? '');
    if ($dayKey !== '') {
      $clauses[] = 'day_key = :day_key';
      $params[':day_key'] = $dayKey;
    }
  }

  return implode(' AND ', $clauses);
}

function analytics_query_all(PDO $pdo, string $sql, array $params = []): array {
  $stmt = $pdo->prepare($sql);
  foreach ($params as $key => $value) {
    if ($value === null) {
      $stmt->bindValue($key, null, PDO::PARAM_NULL);
      continue;
    }
    if (is_int($value)) {
      $stmt->bindValue($key, $value, PDO::PARAM_INT);
      continue;
    }
    $stmt->bindValue($key, (string)$value, PDO::PARAM_STR);
  }
  $stmt->execute();
  return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
}

function analytics_query_row(PDO $pdo, string $sql, array $params = []): array {
  $rows = analytics_query_all($pdo, $sql, $params);
  return $rows[0] ?? [];
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

function contact_to_email(): string {
  $v = env_value('CONTACT_TO_EMAIL');
  if ($v === null) $v = env_value('CONTACT_TO');
  return trim((string)($v ?? ''));
}

function contact_from_email(): string {
  $v = env_value('CONTACT_FROM_EMAIL');
  if ($v !== null && trim($v) !== '') return trim($v);
  $host = (string)($_SERVER['HTTP_X_CANONICAL_HOST'] ?? ($_SERVER['HTTP_HOST'] ?? ($_SERVER['HTTP_X_FORWARDED_HOST'] ?? 'localhost')));
  $host = preg_replace('/:\d+$/', '', $host) ?: 'localhost';
  return 'noreply@' . $host;
}

function contact_rate_limit_per_hour(): int {
  $v = (int)(env_value('CONTACT_RATE_LIMIT_PER_HOUR') ?? 5);
  return max(1, min(100, $v));
}

function contact_rate_limit_path(): string {
  return __DIR__ . '/logs/contact_rate_limit.json';
}

function contact_log_path(): string {
  return __DIR__ . '/logs/contact.log';
}

function contact_client_ip(): string {
  $xff = trim((string)($_SERVER['HTTP_X_FORWARDED_FOR'] ?? ''));
  if ($xff !== '') {
    $parts = array_map('trim', explode(',', $xff));
    if (!empty($parts[0])) return (string)$parts[0];
  }
  return trim((string)($_SERVER['REMOTE_ADDR'] ?? ''));
}

function contact_safe_header_value(string $value): string {
  return str_replace(["\r", "\n"], '', trim($value));
}

function contact_log(string $level, array $data): void {
  try {
    $path = contact_log_path();
    $dir = dirname($path);
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    $row = ['time' => gmdate('c'), 'level' => $level] + $data;
    @file_put_contents($path, json_encode($row, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL, FILE_APPEND | LOCK_EX);
  } catch (Throwable $ignore) {
    // no-op
  }
}

function contact_rate_limit_allowed(string $ip): bool {
  $path = contact_rate_limit_path();
  $dir = dirname($path);
  if (!is_dir($dir)) @mkdir($dir, 0775, true);
  $now = time();
  $windowStart = $now - 3600;
  $limit = contact_rate_limit_per_hour();
  $store = ['hits' => []];
  if (is_file($path)) {
    $raw = file_get_contents($path);
    if ($raw !== false && trim($raw) !== '') {
      $decoded = json_decode($raw, true);
      if (is_array($decoded) && isset($decoded['hits']) && is_array($decoded['hits'])) {
        $store = $decoded;
      }
    }
  }
  $hits = [];
  foreach (($store['hits'] ?? []) as $k => $arr) {
    if (!is_array($arr)) continue;
    $filtered = [];
    foreach ($arr as $ts) {
      $n = (int)$ts;
      if ($n >= $windowStart) $filtered[] = $n;
    }
    if (!empty($filtered)) $hits[(string)$k] = $filtered;
  }
  $ipKey = $ip !== '' ? $ip : 'unknown';
  $ipHits = $hits[$ipKey] ?? [];
  if (count($ipHits) >= $limit) {
    $store['hits'] = $hits;
    @file_put_contents($path, json_encode($store, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);
    return false;
  }
  $ipHits[] = $now;
  $hits[$ipKey] = $ipHits;
  $store['hits'] = $hits;
  @file_put_contents($path, json_encode($store, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);
  return true;
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
    if (admin_password_hash() === '' && admin_token() === '') {
      respond(500, ['authenticated' => false, 'error' => 'Admin token non configurato']);
    }
    if (verify_admin_secret($token)) {
      $_SESSION['cammino_admin_authenticated'] = true;
      $_SESSION['cammino_admin_login_at'] = gmdate('c');
      respond(200, ['authenticated' => true]);
    }
    $_SESSION['cammino_admin_authenticated'] = false;
    respond(401, ['authenticated' => false, 'error' => 'Token non valido']);
  }
  respond(405, ['error' => 'Method not allowed']);
}

if ($path === '/admin/password') {
  if ($method !== 'POST') respond(405, ['error' => 'Method not allowed']);
  require_admin_auth();
  $payload = read_json_body();
  $current = trim((string)($payload['current_password'] ?? ''));
  $next = trim((string)($payload['new_password'] ?? ''));
  if (!verify_admin_secret($current)) {
    respond(401, ['ok' => false, 'error' => 'Password attuale non valida']);
  }
  if (mb_strlen($next) < 8) {
    respond(422, ['ok' => false, 'error' => 'La nuova password deve avere almeno 8 caratteri']);
  }
  if (mb_strlen($next) > 200) {
    respond(422, ['ok' => false, 'error' => 'La nuova password e troppo lunga']);
  }
  try {
    save_admin_auth_store([
      'password_hash' => admin_build_password_hash($next),
      'updated_at' => gmdate('c'),
    ]);
    respond(200, ['ok' => true]);
  } catch (Throwable $e) {
    api_log_error('admin/password', $e);
    respond(500, ['ok' => false, 'error' => 'Impossibile salvare la nuova password']);
  }
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
    api_log_error('admin/comments/delete', $e);
    respond(500, ['error' => 'Cannot persist comments file', 'detail' => api_debug_enabled() ? $e->getMessage() : null]);
  }
  respond(200, ['ok' => true, 'removed' => $removed]);
}

if ($path === '/admin/settings') {
  require_admin_auth();
  if ($method === 'GET') {
    respond(200, ['settings' => load_ui_flags()]);
  }
  if ($method === 'POST') {
    $payload = read_json_body();
    $incoming = [];
    if (isset($payload['settings']) && is_array($payload['settings'])) {
      $incoming = $payload['settings'];
    } elseif (is_array($payload)) {
      $incoming = $payload;
    }
    $next = normalize_ui_flags(is_array($incoming) ? $incoming : []);
    try {
      save_ui_flags($next);
    } catch (Throwable $e) {
      api_log_error('admin/settings/save', $e);
      respond(500, ['error' => 'Cannot persist settings', 'detail' => api_debug_enabled() ? $e->getMessage() : null]);
    }
    respond(200, ['ok' => true, 'settings' => $next]);
  }
  respond(405, ['error' => 'Method not allowed']);
}

if ($path === '/admin/day-og-overrides') {
  require_admin_auth();
  if ($method === 'GET') {
    respond(200, ['overrides' => load_day_og_overrides()]);
  }
  if ($method === 'POST') {
    $payload = read_json_body();
    $incoming = [];
    if (isset($payload['overrides']) && is_array($payload['overrides'])) {
      $incoming = $payload['overrides'];
    } elseif (is_array($payload)) {
      $incoming = $payload;
    }
    $next = normalize_day_og_overrides(is_array($incoming) ? $incoming : []);
    try {
      save_day_og_overrides($next);
    } catch (Throwable $e) {
      api_log_error('admin/day-og-overrides/save', $e);
      respond(500, ['error' => 'Cannot persist day og overrides', 'detail' => api_debug_enabled() ? $e->getMessage() : null]);
    }
    respond(200, ['ok' => true, 'overrides' => $next]);
  }
  respond(405, ['error' => 'Method not allowed']);
}

if ($path === '/public/settings') {
  if ($method !== 'GET') respond(405, ['error' => 'Method not allowed']);
  respond(200, ['settings' => load_ui_flags()]);
}

if ($path === '/delete') {
  respond(501, ['error' => 'Delete endpoint not enabled on PHP static deploy']);
}

if ($path === '/contact/send') {
  if ($method !== 'POST') respond(405, ['error' => 'Method not allowed']);

  $payload = read_json_body();
  $name = trim((string)($payload['name'] ?? ''));
  $email = trim((string)($payload['email'] ?? ''));
  $message = trim((string)($payload['message'] ?? ''));
  $website = trim((string)($payload['website'] ?? '')); // honeypot
  $lang = trim((string)($payload['lang'] ?? ''));
  $package = trim((string)($payload['package'] ?? ''));
  $source = trim((string)($payload['source'] ?? ''));
  $privacyConsentRaw = $payload['privacy_consent'] ?? null;
  $privacyConsent = $privacyConsentRaw === true || $privacyConsentRaw === 1 || $privacyConsentRaw === '1' || $privacyConsentRaw === 'true' || $privacyConsentRaw === 'on';

  if ($website !== '') {
    respond(200, ['ok' => true]);
  }

  if ($name === '' || mb_strlen($name) > 120) {
    respond(400, ['error' => 'Nome non valido: inserisci un nome tra 1 e 120 caratteri.']);
  }
  if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 190) {
    respond(400, ['error' => 'Email non valida: inserisci un indirizzo email valido.']);
  }
  if ($message === '' || mb_strlen($message) < 10 || mb_strlen($message) > 5000) {
    respond(400, ['error' => 'Messaggio non valido: il testo deve essere tra 10 e 5000 caratteri.']);
  }
  if (!$privacyConsent) {
    respond(400, ['error' => 'Consenso privacy mancante: devi accettare la Privacy Policy prima di inviare la richiesta.']);
  }
  if ($package !== '' && mb_strlen($package) > 80) {
    respond(400, ['error' => 'Pacchetto non valido.']);
  }
  if ($source !== '' && mb_strlen($source) > 80) {
    respond(400, ['error' => 'Sorgente non valida.']);
  }

  $ip = contact_client_ip();
  if (!contact_rate_limit_allowed($ip)) {
    respond(429, ['error' => 'Troppe richieste in poco tempo. Riprova più tardi.']);
  }

  $to = contact_to_email();
  if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
    respond(500, ['error' => 'Invio non configurato: destinatario email mancante sul server.']);
  }

  $safeName = contact_safe_header_value($name);
  $safeEmail = contact_safe_header_value($email);
  $safeFrom = contact_safe_header_value(contact_from_email());
  $safePackage = contact_safe_header_value($package);
  $safeSource = contact_safe_header_value($source);
  $subject = 'Richiesta diario interattivo';
  $body = implode("\n", [
    'Nuovo contatto dal form del sito',
    '--------------------------------',
    'Nome: ' . $safeName,
    'Email: ' . $safeEmail,
    'Lingua: ' . $lang,
    'Pacchetto: ' . ($safePackage !== '' ? $safePackage : '-'),
    'Sorgente: ' . ($safeSource !== '' ? $safeSource : '-'),
    'Consenso privacy: sì',
    'IP: ' . $ip,
    'User-Agent: ' . (string)($_SERVER['HTTP_USER_AGENT'] ?? ''),
    'URL: ' . (string)($_SERVER['HTTP_REFERER'] ?? ''),
    '',
    'Messaggio:',
    $message,
    '',
  ]);
  $headers = [];
  $headers[] = 'MIME-Version: 1.0';
  $headers[] = 'Content-Type: text/plain; charset=UTF-8';
  $headers[] = 'From: Cammino Site <' . $safeFrom . '>';
  $headers[] = 'Reply-To: ' . $safeName . ' <' . $safeEmail . '>';

  $ok = @mail($to, $subject, $body, implode("\r\n", $headers));
  contact_log($ok ? 'info' : 'error', [
    'event' => 'contact_send',
    'ok' => $ok,
    'name' => $safeName,
    'email' => $safeEmail,
    'lang' => $lang,
    'ip' => $ip,
  ]);
  if (!$ok) {
    respond(500, ['error' => 'Invio email fallito lato server.']);
  }
  respond(200, ['ok' => true]);
}

if ($path === '/track') {
  if ($method !== 'POST') respond(405, ['error' => 'Method not allowed']);
  if (!analytics_enabled()) respond(200, ['ok' => true, 'accepted' => 0, 'disabled' => true]);
  $payload = read_json_body();
  $incoming = [];
  if (isset($payload['events']) && is_array($payload['events'])) {
    $incoming = $payload['events'];
  } elseif (is_array($payload) && (isset($payload['event_type']) || isset($payload['type']))) {
    $incoming = [$payload];
  }
  if (!is_array($incoming) || count($incoming) === 0) {
    respond(400, ['error' => 'No events']);
  }
  $incoming = array_slice($incoming, 0, 50);
  $cid = analytics_string($payload['cid'] ?? '', 64);
  $sessionId = analytics_string($payload['session_id'] ?? '', 64);
  if ($cid === '') $cid = bin2hex(random_bytes(8));
  if ($sessionId === '') $sessionId = bin2hex(random_bytes(8));
  $langGlobal = analytics_string($payload['lang'] ?? '', 8);
  $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '');
  $ua = (string)($_SERVER['HTTP_USER_AGENT'] ?? '');
  $ref = (string)($_SERVER['HTTP_REFERER'] ?? '');
  $refHost = '';
  if ($ref !== '') {
    $refHost = analytics_string((string)(parse_url($ref, PHP_URL_HOST) ?? ''), 120);
  }
  $ipHash = analytics_hash($ip);
  $uaHash = analytics_hash($ua);

  try {
    $pdo = analytics_pdo();
    $stmt = $pdo->prepare('
      INSERT INTO analytics_events (
        created_at, cid, session_id, event_type, path, lang, day_key, media_id, target_id,
        referrer_host, ip_raw, user_agent_raw, user_agent_hash, ip_hash, metadata_json
      ) VALUES (
        :created_at, :cid, :session_id, :event_type, :path, :lang, :day_key, :media_id, :target_id,
        :referrer_host, :ip_raw, :user_agent_raw, :user_agent_hash, :ip_hash, :metadata_json
      )
    ');
    $accepted = 0;
    foreach ($incoming as $event) {
      if (!is_array($event)) continue;
      $eventType = analytics_normalize_event_type($event['event_type'] ?? $event['type'] ?? '');
      if ($eventType === '') continue;
      $pathValue = analytics_string($event['path'] ?? '', 300);
      $lang = analytics_string($event['lang'] ?? $langGlobal, 8);
      $dayKey = analytics_normalize_day_key($event['day_key'] ?? '');
      $mediaId = analytics_string($event['media_id'] ?? '', 80);
      $targetId = analytics_string($event['target_id'] ?? '', 80);
      $meta = $event['meta'] ?? [];
      if (!is_array($meta)) $meta = [];
      $metaJson = json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
      if ($metaJson === false) $metaJson = '{}';
      $stmt->execute([
        ':created_at' => gmdate('Y-m-d H:i:s'),
        ':cid' => $cid,
        ':session_id' => $sessionId,
        ':event_type' => $eventType,
        ':path' => $pathValue,
        ':lang' => $lang,
        ':day_key' => $dayKey,
        ':media_id' => $mediaId,
        ':target_id' => $targetId,
        ':referrer_host' => $refHost,
        ':ip_raw' => analytics_store_raw_ip() ? analytics_string($ip, 64) : null,
        ':user_agent_raw' => analytics_store_raw_ua() ? analytics_string($ua, 2000) : null,
        ':user_agent_hash' => $uaHash,
        ':ip_hash' => $ipHash,
        ':metadata_json' => $metaJson,
      ]);
      $accepted += 1;
    }
    respond(200, ['ok' => true, 'accepted' => $accepted]);
  } catch (Throwable $e) {
    api_log_error('analytics/track', $e, [
      'events_in_request' => is_array($incoming) ? count($incoming) : 0,
      'cid' => $cid ?? '',
      'session_id' => $sessionId ?? '',
    ]);
    respond(500, ['error' => 'Cannot persist analytics events', 'detail' => api_debug_enabled() ? $e->getMessage() : null]);
  }
}

if ($path === '/admin/analytics/overview') {
  if ($method !== 'GET') respond(405, ['error' => 'Method not allowed']);
  require_admin_auth();
  if (!analytics_enabled()) respond(200, ['disabled' => true]);
  try {
    $pdo = analytics_pdo();
    $filters = analytics_parse_overview_filters();
    $params = [];
    $whereSql = analytics_build_where($filters, $params);
    $optionParams = [];
    $optionWhereSql = analytics_build_where($filters, $optionParams, false, false);
    $bucketSql = $filters['group_by'] === 'month'
      ? "DATE_FORMAT(created_at, '%Y-%m-01')"
      : "DATE(created_at)";

    $totals = analytics_query_row($pdo, "
      SELECT
        COUNT(*) AS total_events,
        COUNT(DISTINCT cid) AS unique_visitors,
        COUNT(DISTINCT session_id) AS unique_sessions,
        SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS page_views,
        SUM(CASE WHEN event_type = 'day_view' THEN 1 ELSE 0 END) AS day_views,
        SUM(CASE WHEN event_type = 'media_open' THEN 1 ELSE 0 END) AS media_opens,
        SUM(CASE WHEN event_type = 'comments_open' THEN 1 ELSE 0 END) AS comments_open,
        SUM(CASE WHEN event_type = 'comment_submit' THEN 1 ELSE 0 END) AS comment_submit,
        SUM(CASE WHEN event_type = 'share_click' THEN 1 ELSE 0 END) AS share_click,
        SUM(CASE WHEN event_type = 'scroll_depth' THEN 1 ELSE 0 END) AS scroll_events,
        ROUND(AVG(CASE
          WHEN event_type = 'scroll_depth'
            THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.bucket')) AS UNSIGNED)
          ELSE NULL
        END), 1) AS avg_scroll_bucket,
        MAX(CASE
          WHEN event_type = 'scroll_depth'
            THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.bucket')) AS UNSIGNED)
          ELSE NULL
        END) AS max_scroll_bucket
      FROM analytics_events
      WHERE {$whereSql}
    ", $params);

    $series = analytics_query_all($pdo, "
      SELECT
        {$bucketSql} AS bucket_start,
        COUNT(*) AS total_events,
        COUNT(DISTINCT cid) AS unique_visitors,
        COUNT(DISTINCT session_id) AS unique_sessions,
        SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS page_views,
        SUM(CASE WHEN event_type = 'day_view' THEN 1 ELSE 0 END) AS day_views,
        SUM(CASE WHEN event_type = 'media_open' THEN 1 ELSE 0 END) AS media_opens,
        SUM(CASE WHEN event_type = 'comments_open' THEN 1 ELSE 0 END) AS comments_open,
        SUM(CASE WHEN event_type = 'comment_submit' THEN 1 ELSE 0 END) AS comment_submit,
        SUM(CASE WHEN event_type = 'share_click' THEN 1 ELSE 0 END) AS share_click,
        SUM(CASE WHEN event_type = 'scroll_depth' THEN 1 ELSE 0 END) AS scroll_events,
        ROUND(AVG(CASE
          WHEN event_type = 'scroll_depth'
            THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.bucket')) AS UNSIGNED)
          ELSE NULL
        END), 1) AS avg_scroll_bucket,
        MAX(CASE
          WHEN event_type = 'scroll_depth'
            THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.bucket')) AS UNSIGNED)
          ELSE NULL
        END) AS max_scroll_bucket
      FROM analytics_events
      WHERE {$whereSql}
      GROUP BY bucket_start
      ORDER BY bucket_start ASC
      LIMIT 400
    ", $params);

    $topPaths = analytics_query_all($pdo, "
      SELECT
        path,
        COUNT(*) AS page_views,
        COUNT(DISTINCT cid) AS unique_visitors,
        COUNT(DISTINCT session_id) AS unique_sessions,
        MAX(created_at) AS last_seen
      FROM analytics_events
      WHERE {$whereSql}
        AND event_type = 'page_view'
        AND path IS NOT NULL
        AND path <> ''
      GROUP BY path
      ORDER BY unique_visitors DESC, page_views DESC, path ASC
      LIMIT 40
    ", $params);

    $dayBreakdown = analytics_query_all($pdo, "
      SELECT
        day_key,
        COUNT(DISTINCT cid) AS unique_readers,
        COUNT(DISTINCT session_id) AS unique_sessions,
        SUM(CASE WHEN event_type = 'day_view' THEN 1 ELSE 0 END) AS day_views,
        SUM(CASE WHEN event_type = 'media_open' THEN 1 ELSE 0 END) AS media_opens,
        SUM(CASE WHEN event_type = 'comments_open' THEN 1 ELSE 0 END) AS comments_open,
        SUM(CASE WHEN event_type = 'comment_submit' THEN 1 ELSE 0 END) AS comment_submit,
        SUM(CASE WHEN event_type = 'share_click' THEN 1 ELSE 0 END) AS share_click,
        ROUND(AVG(CASE
          WHEN event_type = 'scroll_depth'
            THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.bucket')) AS UNSIGNED)
          ELSE NULL
        END), 1) AS avg_scroll_bucket,
        MAX(CASE
          WHEN event_type = 'scroll_depth'
            THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.bucket')) AS UNSIGNED)
          ELSE NULL
        END) AS max_scroll_bucket,
        MAX(created_at) AS last_seen
      FROM analytics_events
      WHERE {$whereSql}
        AND day_key IS NOT NULL
        AND day_key <> ''
      GROUP BY day_key
      HAVING day_views > 0
         OR media_opens > 0
         OR comments_open > 0
         OR comment_submit > 0
         OR share_click > 0
         OR avg_scroll_bucket IS NOT NULL
      ORDER BY day_key DESC, unique_readers DESC, day_views DESC
      LIMIT 80
    ", $params);

    $scrollBuckets = analytics_query_all($pdo, "
      SELECT
        CAST(JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.bucket')) AS UNSIGNED) AS bucket,
        COUNT(*) AS n
      FROM analytics_events
      WHERE {$whereSql}
        AND event_type = 'scroll_depth'
      GROUP BY bucket
      ORDER BY bucket ASC
    ", $params);

    $pathEngagement = analytics_query_all($pdo, "
      SELECT
        path,
        COUNT(DISTINCT cid) AS unique_visitors,
        COUNT(DISTINCT session_id) AS unique_sessions,
        SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS page_views,
        ROUND(AVG(CASE
          WHEN event_type = 'scroll_depth'
            THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.bucket')) AS UNSIGNED)
          ELSE NULL
        END), 1) AS avg_scroll_bucket,
        MAX(CASE
          WHEN event_type = 'scroll_depth'
            THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.bucket')) AS UNSIGNED)
          ELSE NULL
        END) AS max_scroll_bucket,
        MAX(created_at) AS last_seen
      FROM analytics_events
      WHERE {$whereSql}
        AND path IS NOT NULL
        AND path <> ''
        AND event_type IN ('page_view', 'scroll_depth')
      GROUP BY path
      ORDER BY unique_visitors DESC, page_views DESC, path ASC
      LIMIT 40
    ", $params);

    $topMedia = analytics_query_all($pdo, "
      SELECT
        media_id,
        COUNT(*) AS n,
        COUNT(DISTINCT cid) AS unique_visitors
      FROM analytics_events
      WHERE {$whereSql}
        AND event_type = 'media_open'
        AND media_id IS NOT NULL
        AND media_id <> ''
      GROUP BY media_id
      ORDER BY n DESC, unique_visitors DESC, media_id ASC
      LIMIT 30
    ", $params);

    $langs = analytics_query_all($pdo, "
      SELECT lang, COUNT(*) AS n
      FROM analytics_events
      WHERE {$optionWhereSql}
        AND lang IS NOT NULL
        AND lang <> ''
      GROUP BY lang
      ORDER BY n DESC, lang ASC
      LIMIT 12
    ", $optionParams);

    $events = analytics_query_all($pdo, "
      SELECT event_type, COUNT(*) AS n
      FROM analytics_events
      WHERE {$whereSql}
      GROUP BY event_type
      ORDER BY n DESC, event_type ASC
      LIMIT 30
    ", $params);

    $pathOptions = analytics_query_all($pdo, "
      SELECT path, COUNT(*) AS n
      FROM analytics_events
      WHERE {$optionWhereSql}
        AND event_type = 'page_view'
        AND path IS NOT NULL
        AND path <> ''
      GROUP BY path
      ORDER BY n DESC, path ASC
      LIMIT 80
    ", $optionParams);

    $dayOptions = analytics_query_all($pdo, "
      SELECT day_key, COUNT(*) AS n
      FROM analytics_events
      WHERE {$optionWhereSql}
        AND day_key IS NOT NULL
        AND day_key <> ''
      GROUP BY day_key
      ORDER BY day_key DESC
      LIMIT 120
    ", $optionParams);

    respond(200, [
      'filters' => [
        'days' => $filters['days'],
        'from' => $filters['from'],
        'to' => $filters['to'],
        'period_days' => $filters['period_days'],
        'group_by' => $filters['group_by'],
        'lang' => $filters['lang'],
        'path' => $filters['path'],
        'day_key' => $filters['day_key'],
      ],
      'totals' => [
        'total_events' => (int)($totals['total_events'] ?? 0),
        'unique_visitors' => (int)($totals['unique_visitors'] ?? 0),
        'unique_sessions' => (int)($totals['unique_sessions'] ?? 0),
        'page_views' => (int)($totals['page_views'] ?? 0),
        'day_views' => (int)($totals['day_views'] ?? 0),
        'media_opens' => (int)($totals['media_opens'] ?? 0),
        'comments_open' => (int)($totals['comments_open'] ?? 0),
        'comment_submit' => (int)($totals['comment_submit'] ?? 0),
        'share_click' => (int)($totals['share_click'] ?? 0),
        'scroll_events' => (int)($totals['scroll_events'] ?? 0),
        'avg_scroll_bucket' => $totals['avg_scroll_bucket'] === null ? null : (float)$totals['avg_scroll_bucket'],
        'max_scroll_bucket' => $totals['max_scroll_bucket'] === null ? null : (int)$totals['max_scroll_bucket'],
      ],
      'series' => $series,
      'top_paths' => $topPaths,
      'day_breakdown' => $dayBreakdown,
      'scroll_buckets' => $scrollBuckets,
      'path_engagement' => $pathEngagement,
      'top_media' => $topMedia,
      'langs' => $langs,
      'events_by_type' => $events,
      'filter_options' => [
        'langs' => $langs,
        'paths' => $pathOptions,
        'day_keys' => $dayOptions,
      ],
    ]);
  } catch (Throwable $e) {
    api_log_error('analytics/overview', $e, ['filters' => $filters ?? null]);
    respond(500, ['error' => 'Cannot read analytics overview', 'detail' => api_debug_enabled() ? $e->getMessage() : null]);
  }
}

if ($path === '/admin/analytics/health') {
  if ($method !== 'GET') respond(405, ['error' => 'Method not allowed']);
  require_admin_auth();
  if (!analytics_enabled()) {
    respond(200, [
      'ok' => false,
      'enabled' => false,
      'message' => 'Analytics disabled',
      'config' => [
        'host' => analytics_mysql_host(),
        'port' => analytics_mysql_port(),
        'db' => analytics_mysql_db(),
        'user' => analytics_mysql_user(),
      ]
    ]);
  }
  try {
    $pdo = analytics_pdo();
    $serverVersion = '';
    try {
      $serverVersion = (string)$pdo->query('SELECT VERSION()')->fetchColumn();
    } catch (Throwable $ignore) {
      $serverVersion = '';
    }

    $tableExists = false;
    $rows = 0;
    try {
      $stmt = $pdo->query("SHOW TABLES LIKE 'analytics_events'");
      $tableExists = (bool)$stmt->fetchColumn();
    } catch (Throwable $ignore) {
      $tableExists = false;
    }
    if ($tableExists) {
      try {
        $rows = (int)$pdo->query('SELECT COUNT(*) FROM analytics_events')->fetchColumn();
      } catch (Throwable $ignore) {
        $rows = 0;
      }
    }

    respond(200, [
      'ok' => true,
      'enabled' => true,
      'can_connect' => true,
      'server_version' => $serverVersion,
      'table' => [
        'name' => 'analytics_events',
        'exists' => $tableExists,
        'rows' => $rows,
      ],
      'config' => [
        'host' => analytics_mysql_host(),
        'port' => analytics_mysql_port(),
        'db' => analytics_mysql_db(),
        'user' => analytics_mysql_user(),
      ]
    ]);
  } catch (Throwable $e) {
    api_log_error('analytics/health', $e);
    respond(200, [
      'ok' => false,
      'enabled' => true,
      'can_connect' => false,
      'error' => 'DB connection failed',
      'detail' => api_debug_enabled() ? $e->getMessage() : null,
      'config' => [
        'host' => analytics_mysql_host(),
        'port' => analytics_mysql_port(),
        'db' => analytics_mysql_db(),
        'user' => analytics_mysql_user(),
      ]
    ]);
  }
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
  if ($targets) {
    foreach ($targets as $t) $counts[$t] = 0;
    foreach ($store['comments'] as $comment) {
      if (!is_array($comment)) continue;
      $target = normalize_target((string)($comment['target'] ?? ''));
      if ($target === '' || !array_key_exists($target, $counts)) continue;
      $counts[$target] += 1;
    }
  } else {
    foreach ($store['comments'] as $comment) {
      if (!is_array($comment)) continue;
      $target = normalize_target((string)($comment['target'] ?? ''));
      if ($target === '') continue;
      $counts[$target] = (int)($counts[$target] ?? 0) + 1;
    }
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
      api_log_error('comments/post', $e);
      respond(500, ['error' => 'Cannot persist comment', 'detail' => api_debug_enabled() ? $e->getMessage() : null]);
    }
    respond(201, ['ok' => true, 'comment' => $record]);
  }

  respond(405, ['error' => 'Method not allowed']);
}

respond(404, ['error' => 'Not found']);

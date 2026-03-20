<?php
declare(strict_types=1);

const STUDIO_ROOT = __DIR__ . '/..';

function studio_session_boot(): void {
  if (session_status() === PHP_SESSION_ACTIVE) return;
  session_name('cammino_studio_session');
  session_start();
}

function studio_now(): string {
  return gmdate('c');
}

function studio_json_response(int $status, array $payload): void {
  http_response_code($status);
  echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

function studio_read_json_body(): array {
  $raw = file_get_contents('php://input');
  if ($raw === false || trim($raw) === '') return [];
  $decoded = json_decode($raw, true);
  return is_array($decoded) ? $decoded : [];
}

function studio_env_map(): array {
  static $cache = null;
  if (is_array($cache)) return $cache;
  $cache = [];
  $paths = [
    dirname(STUDIO_ROOT) . '/.env',
    STUDIO_ROOT . '/.env',
  ];
  foreach ($paths as $path) {
    if (!is_file($path)) continue;
    $raw = file_get_contents($path);
    if ($raw === false) continue;
    $lines = preg_split('/\r\n|\r|\n/', $raw) ?: [];
    foreach ($lines as $line) {
      $line = trim($line);
      if ($line === '' || str_starts_with($line, '#')) continue;
      $pos = strpos($line, '=');
      if ($pos === false) continue;
      $key = trim(substr($line, 0, $pos));
      $value = trim(substr($line, $pos + 1));
      if ($key === '') continue;
      if ((str_starts_with($value, '"') && str_ends_with($value, '"')) || (str_starts_with($value, "'") && str_ends_with($value, "'"))) {
        $value = substr($value, 1, -1);
      }
      $cache[$key] = $value;
    }
  }
  return $cache;
}

function studio_env(string $key, ?string $default = null): ?string {
  $value = getenv($key);
  if ($value !== false && trim((string)$value) !== '') return (string)$value;
  $map = studio_env_map();
  if (isset($map[$key]) && trim((string)$map[$key]) !== '') return (string)$map[$key];
  return $default;
}

function studio_admin_password(): string {
  $candidates = [
    'STUDIO_ADMIN_PASSWORD',
    'ADMIN_PASSWORD',
    'COMMENTS_ADMIN_TOKEN',
    'CAMMINO_ADMIN_TOKEN',
    'ADMIN_TOKEN',
  ];
  foreach ($candidates as $key) {
    $value = studio_env($key);
    if ($value !== null && trim($value) !== '') return trim($value);
  }
  return '';
}

function studio_is_authenticated(): bool {
  return !empty($_SESSION['studio_authenticated']) && $_SESSION['studio_authenticated'] === true;
}

function studio_require_auth(): void {
  if (!studio_is_authenticated()) {
    studio_json_response(401, ['error' => 'Unauthorized']);
  }
}

function studio_api_path(): string {
  $path = trim((string)($_GET['path'] ?? ''), '/');
  if ($path !== '') return '/' . $path;
  $requestPath = (string)(parse_url($_SERVER['REQUEST_URI'] ?? '/api', PHP_URL_PATH) ?? '/api');
  foreach (['/studio/api', '/api'] as $prefix) {
    if (stripos($requestPath, $prefix) === 0) {
      $requestPath = substr($requestPath, strlen($prefix));
      break;
    }
  }
  $requestPath = '/' . ltrim($requestPath, '/');
  return $requestPath === '//' ? '/' : $requestPath;
}

function studio_storage_root(): string {
  $path = STUDIO_ROOT . '/storage';
  if (!is_dir($path)) {
    mkdir($path, 0775, true);
  }
  return $path;
}

function studio_slugify(string $value): string {
  $value = trim(strtolower($value));
  if ($value === '') return '';
  $value = preg_replace('/[^a-z0-9]+/', '-', $value) ?? '';
  $value = trim($value, '-');
  return $value;
}

function studio_clean_text(mixed $value): string {
  return trim(preg_replace('/\s+/u', ' ', (string)$value) ?? '');
}

function studio_clean_multiline(mixed $value): string {
  $text = str_replace(["\r\n", "\r"], "\n", (string)$value);
  return trim($text);
}

function studio_safe_filename(string $name): string {
  $name = basename($name);
  $name = preg_replace('/[^A-Za-z0-9._-]+/', '-', $name) ?? 'file';
  $name = trim($name, '-');
  return $name !== '' ? $name : 'file';
}

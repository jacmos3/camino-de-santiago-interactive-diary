<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/lib/bootstrap.php';
require_once dirname(__DIR__) . '/lib/store.php';
require_once dirname(__DIR__) . '/lib/media_processor.php';

studio_session_boot();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
  http_response_code(204);
  exit;
}

$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$path = studio_api_path();

if ($path === '/session/login' && $method === 'POST') {
  $payload = studio_read_json_body();
  $password = trim((string)($payload['password'] ?? ''));
  $configured = studio_admin_password();
  if ($configured === '') {
    studio_json_response(500, ['error' => 'Studio admin password non configurata']);
  }
  if (!hash_equals($configured, $password)) {
    studio_json_response(401, ['error' => 'Password non valida']);
  }
  $_SESSION['studio_authenticated'] = true;
  $_SESSION['studio_login_at'] = studio_now();
  studio_json_response(200, ['ok' => true, 'authenticated' => true]);
}

if ($path === '/session/logout' && $method === 'POST') {
  $_SESSION = [];
  if (ini_get('session.use_cookies')) {
    $params = session_get_cookie_params();
    setcookie(session_name(), '', time() - 42000, $params['path'] ?? '/', $params['domain'] ?? '', (bool)($params['secure'] ?? false), (bool)($params['httponly'] ?? true));
  }
  session_destroy();
  studio_json_response(200, ['ok' => true, 'authenticated' => false]);
}

if ($path === '/me' && $method === 'GET') {
  studio_json_response(200, ['authenticated' => studio_is_authenticated()]);
}

studio_require_auth();

if ($path === '/projects' && $method === 'GET') {
  studio_json_response(200, ['projects' => studio_list_projects()]);
}

if ($path === '/projects' && $method === 'POST') {
  $payload = studio_read_json_body();
  $project = studio_create_project($payload);
  studio_json_response(201, ['project' => $project]);
}

if (preg_match('#^/projects/(\d+)$#', $path, $m)) {
  $projectId = (int)$m[1];
  if ($method === 'GET') {
    $project = studio_get_project($projectId);
    if (!$project) studio_json_response(404, ['error' => 'Project not found']);
    studio_json_response(200, ['project' => $project]);
  }
  if ($method === 'PATCH') {
    $project = studio_update_project($projectId, studio_read_json_body());
    studio_json_response(200, ['project' => $project]);
  }
}

if (preg_match('#^/projects/(\d+)/preview$#', $path, $m) && $method === 'GET') {
  $projectId = (int)$m[1];
  $project = studio_get_project($projectId);
  if (!$project) studio_json_response(404, ['error' => 'Project not found']);
  studio_json_response(200, ['project' => $project, 'preview_url' => $project['preview_url']]);
}

if (preg_match('#^/projects/(\d+)/publish$#', $path, $m) && $method === 'POST') {
  $projectId = (int)$m[1];
  $project = studio_publish_project($projectId);
  studio_json_response(200, ['ok' => true, 'project' => $project]);
}

if (preg_match('#^/projects/(\d+)/days$#', $path, $m)) {
  $projectId = (int)$m[1];
  if ($method === 'GET') {
    studio_json_response(200, ['days' => studio_list_days($projectId)]);
  }
  if ($method === 'POST') {
    $day = studio_create_day($projectId, studio_read_json_body());
    studio_json_response(201, ['day' => $day]);
  }
}

if (preg_match('#^/days/(\d+)$#', $path, $m)) {
  $dayId = (int)$m[1];
  if ($method === 'GET') {
    $day = studio_get_day($dayId, true);
    if (!$day) studio_json_response(404, ['error' => 'Day not found']);
    studio_json_response(200, ['day' => $day]);
  }
  if ($method === 'PATCH') {
    $day = studio_update_day($dayId, studio_read_json_body());
    studio_json_response(200, ['day' => $day]);
  }
}

if (preg_match('#^/days/(\d+)/process$#', $path, $m) && $method === 'POST') {
  $dayId = (int)$m[1];
  $day = studio_get_day($dayId, false);
  if (!$day) studio_json_response(404, ['error' => 'Day not found']);
  $result = studio_process_pending_jobs((int)$day['project_id'], $dayId);
  studio_json_response(200, [
    'ok' => true,
    'processed' => $result,
    'day' => studio_get_day($dayId, true),
  ]);
}

if (preg_match('#^/days/(\d+)/media$#', $path, $m) && $method === 'POST') {
  $dayId = (int)$m[1];
  $result = studio_store_uploaded_media($dayId, $_FILES);
  studio_json_response(201, $result);
}

studio_json_response(404, ['error' => 'Not found']);

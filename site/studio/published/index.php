<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/lib/bootstrap.php';
require_once dirname(__DIR__) . '/lib/store.php';

$slug = trim((string)($_GET['project'] ?? ''));
$project = $slug !== '' ? studio_get_project_by_slug($slug) : null;
if (!$project || $project['status'] !== 'published') {
  http_response_code(404);
  echo 'Published project not found.';
  exit;
}

$_GET['project'] = $slug;
require dirname(__DIR__) . '/preview/index.php';

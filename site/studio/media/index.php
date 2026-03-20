<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/lib/bootstrap.php';
require_once dirname(__DIR__) . '/lib/store.php';

$id = (int)($_GET['id'] ?? 0);
if ($id <= 0) {
  http_response_code(404);
  exit('Media not found');
}

$pdo = studio_db();
$stmt = $pdo->prepare('SELECT * FROM media_items WHERE id = :id LIMIT 1');
$stmt->execute([':id' => $id]);
$media = $stmt->fetch();
if (!$media) {
  http_response_code(404);
  exit('Media not found');
}

$variant = trim((string)($_GET['variant'] ?? 'original'));
$srcPath = trim((string)($media['storage_render_path'] ?? '')) ?: (string)$media['storage_original_path'];
$path = match ($variant) {
  'src' => $srcPath,
  'thumb' => trim((string)($media['storage_thumb_path'] ?? '')) ?: (trim((string)($media['storage_render_path'] ?? '')) ?: (string)$media['storage_original_path']),
  'poster' => trim((string)($media['storage_poster_path'] ?? '')),
  default => (string)$media['storage_original_path'],
};
if (!is_file($path)) {
  http_response_code(404);
  exit('File not found');
}

$mime = match ($variant) {
  'poster', 'thumb' => 'image/jpeg',
  'src' => ($srcPath !== (string)$media['storage_original_path'])
    ? trim((string)($media['type'] === 'video' ? 'video/mp4' : 'image/jpeg'))
    : trim((string)$media['mime_type']),
  default => trim((string)$media['mime_type']),
};
if ($mime === '') $mime = 'application/octet-stream';
header('Content-Type: ' . $mime);
header('Content-Length: ' . (string)filesize($path));
header('Cache-Control: no-store');
readfile($path);
exit;

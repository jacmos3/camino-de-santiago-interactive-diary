<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/store.php';

const STUDIO_IMAGE_MAX_SIDE = 2048;
const STUDIO_THUMB_SIDE = 640;
const STUDIO_VIDEO_MAX_SIDE = 1280;

function studio_find_binary(string $name): string {
  static $cache = [];
  if (isset($cache[$name])) return $cache[$name];
  $candidates = match ($name) {
    'ffmpeg' => ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg'],
    'ffprobe' => ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', 'ffprobe'],
    'exiftool' => ['/opt/homebrew/bin/exiftool', '/usr/local/bin/exiftool', 'exiftool'],
    'sips' => ['/usr/bin/sips', 'sips'],
    default => [$name],
  };
  foreach ($candidates as $candidate) {
    if (str_contains($candidate, '/')) {
      if (is_file($candidate) && is_executable($candidate)) {
        return $cache[$name] = $candidate;
      }
      continue;
    }
    $resolved = trim((string)shell_exec('command -v ' . escapeshellarg($candidate) . ' 2>/dev/null'));
    if ($resolved !== '') {
      return $cache[$name] = $resolved;
    }
  }
  throw new RuntimeException("Binary non trovato: {$name}");
}

function studio_run_command(array $command): array {
  $descriptors = [
    0 => ['pipe', 'r'],
    1 => ['pipe', 'w'],
    2 => ['pipe', 'w'],
  ];
  $process = proc_open($command, $descriptors, $pipes, null, null, ['bypass_shell' => true]);
  if (!is_resource($process)) {
    throw new RuntimeException('Impossibile avviare il processo esterno');
  }
  fclose($pipes[0]);
  $stdout = stream_get_contents($pipes[1]);
  $stderr = stream_get_contents($pipes[2]);
  fclose($pipes[1]);
  fclose($pipes[2]);
  $exitCode = proc_close($process);
  if ($exitCode !== 0) {
    $label = implode(' ', array_map(static fn($part): string => (string)$part, $command));
    throw new RuntimeException(trim($label . ' failed (' . $exitCode . ') ' . trim((string)$stderr)));
  }
  return [
    'stdout' => (string)$stdout,
    'stderr' => (string)$stderr,
  ];
}

function studio_processed_media_dir(int $projectId, int $dayId): string {
  $dir = studio_storage_root() . '/processed/project-' . $projectId . '/day-' . $dayId;
  if (!is_dir($dir)) mkdir($dir, 0775, true);
  return $dir;
}

function studio_detect_mime(string $path): string {
  $finfo = new finfo(FILEINFO_MIME_TYPE);
  $mime = trim((string)$finfo->file($path));
  return $mime !== '' ? $mime : 'application/octet-stream';
}

function studio_parse_exif_local_date(mixed $raw): string {
  $value = trim((string)$raw);
  if ($value === '') return '';
  if (preg_match('/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/', $value, $m)) {
    return sprintf('%s-%s-%sT%s:%s:%s', $m[1], $m[2], $m[3], $m[4], $m[5], $m[6]);
  }
  if (preg_match('/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2}):(\d{2})/', $value, $m)) {
    return sprintf('%s-%s-%sT%s:%s:%s', $m[1], $m[2], $m[3], $m[4], $m[5], $m[6]);
  }
  return '';
}

function studio_extract_media_metadata(string $path, string $type): array {
  $command = [
    studio_find_binary('exiftool'),
    '-api', 'QuickTimeUTC=1',
    '-json',
    '-n',
    '-q',
    '-q',
    '-FileTypeExtension',
    '-MIMEType',
    '-DateTimeOriginal',
    '-CreateDate',
    '-MediaCreateDate',
    '-TrackCreateDate',
    '-ContentCreateDate',
    '-FileModifyDate',
    '-GPSLatitude',
    '-GPSLongitude',
    $path,
  ];
  if ($type === 'video') {
    $command[] = '-Duration#';
  }
  $out = studio_run_command($command);
  $rows = json_decode((string)$out['stdout'], true);
  $row = is_array($rows) && isset($rows[0]) && is_array($rows[0]) ? $rows[0] : [];
  $capturedAt = '';
  foreach (['DateTimeOriginal', 'CreateDate', 'MediaCreateDate', 'TrackCreateDate', 'ContentCreateDate', 'FileModifyDate'] as $key) {
    $capturedAt = studio_parse_exif_local_date($row[$key] ?? '');
    if ($capturedAt !== '') break;
  }
  $lat = isset($row['GPSLatitude']) && is_numeric($row['GPSLatitude']) ? (float)$row['GPSLatitude'] : null;
  $lon = isset($row['GPSLongitude']) && is_numeric($row['GPSLongitude']) ? (float)$row['GPSLongitude'] : null;
  $mime = trim((string)($row['MIMEType'] ?? ''));
  if ($mime === '') $mime = studio_detect_mime($path);
  $duration = isset($row['Duration']) && is_numeric($row['Duration']) ? (float)$row['Duration'] : null;
  if ($type === 'video' && ($duration === null || $duration <= 0)) {
    $duration = studio_probe_video_duration($path);
  }
  return [
    'captured_at' => $capturedAt,
    'lat' => $lat,
    'lon' => $lon,
    'mime_type' => $mime,
    'duration_sec' => $duration,
    'raw' => $row,
  ];
}

function studio_probe_video_duration(string $path): ?float {
  try {
    $out = studio_run_command([
      studio_find_binary('ffprobe'),
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      $path,
    ]);
    $value = trim((string)$out['stdout']);
    if ($value !== '' && is_numeric($value)) return (float)$value;
  } catch (Throwable) {
    return null;
  }
  return null;
}

function studio_image_paths(int $mediaId, int $projectId, int $dayId): array {
  $dir = studio_processed_media_dir($projectId, $dayId);
  return [
    'render' => $dir . '/img_' . $mediaId . '.jpg',
    'thumb' => $dir . '/thumb_' . $mediaId . '.jpg',
  ];
}

function studio_video_paths(int $mediaId, int $projectId, int $dayId): array {
  $dir = studio_processed_media_dir($projectId, $dayId);
  return [
    'render' => $dir . '/vid_' . $mediaId . '.mp4',
    'poster' => $dir . '/poster_' . $mediaId . '.jpg',
  ];
}

function studio_generate_image_derivatives(int $mediaId, int $projectId, int $dayId, string $inputPath): array {
  $paths = studio_image_paths($mediaId, $projectId, $dayId);
  try {
    studio_run_command([studio_find_binary('sips'), '-s', 'format', 'jpeg', $inputPath, '--out', $paths['render']]);
    studio_run_command([studio_find_binary('sips'), '-s', 'formatOptions', 'best', $paths['render']]);
    studio_run_command([studio_find_binary('sips'), '-Z', (string)STUDIO_IMAGE_MAX_SIDE, $paths['render']]);
    copy($paths['render'], $paths['thumb']);
    studio_run_command([studio_find_binary('sips'), '-s', 'formatOptions', 'high', $paths['thumb']]);
    studio_run_command([studio_find_binary('sips'), '-Z', (string)STUDIO_THUMB_SIDE, $paths['thumb']]);
  } catch (Throwable) {
    $renderScale = "scale='if(gt(iw,ih),min(" . STUDIO_IMAGE_MAX_SIDE . ",iw),-2)':'if(gt(iw,ih),-2,min(" . STUDIO_IMAGE_MAX_SIDE . ",ih))'";
    $thumbScale = "scale='if(gt(iw,ih),min(" . STUDIO_THUMB_SIDE . ",iw),-2)':'if(gt(iw,ih),-2,min(" . STUDIO_THUMB_SIDE . ",ih))'";
    studio_run_command([studio_find_binary('ffmpeg'), '-y', '-loglevel', 'error', '-i', $inputPath, '-vf', $renderScale, '-q:v', '4', $paths['render']]);
    studio_run_command([studio_find_binary('ffmpeg'), '-y', '-loglevel', 'error', '-i', $inputPath, '-vf', $thumbScale, '-q:v', '8', $paths['thumb']]);
  }
  return [
    'storage_render_path' => $paths['render'],
    'storage_thumb_path' => $paths['thumb'],
    'storage_poster_path' => '',
  ];
}

function studio_generate_video_derivatives(int $mediaId, int $projectId, int $dayId, string $inputPath): array {
  $paths = studio_video_paths($mediaId, $projectId, $dayId);
  $scale = "scale='if(gt(iw,ih),min(" . STUDIO_VIDEO_MAX_SIDE . ",iw),-2)':'if(gt(iw,ih),-2,min(" . STUDIO_VIDEO_MAX_SIDE . ",ih))'";
  studio_run_command([
    studio_find_binary('ffmpeg'),
    '-y',
    '-loglevel', 'error',
    '-i', $inputPath,
    '-vf', $scale,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '24',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-c:a', 'aac',
    '-b:a', '128k',
    $paths['render'],
  ]);
  try {
    studio_run_command([studio_find_binary('ffmpeg'), '-y', '-loglevel', 'error', '-ss', '00:00:00.500', '-i', $inputPath, '-frames:v', '1', '-q:v', '4', $paths['poster']]);
  } catch (Throwable) {
    studio_run_command([studio_find_binary('ffmpeg'), '-y', '-loglevel', 'error', '-i', $inputPath, '-frames:v', '1', '-q:v', '4', $paths['poster']]);
  }
  return [
    'storage_render_path' => $paths['render'],
    'storage_thumb_path' => '',
    'storage_poster_path' => $paths['poster'],
  ];
}

function studio_reverse_geocode(float $lat, float $lon): string {
  $template = trim((string)studio_env('STUDIO_REVERSE_GEOCODE_TEMPLATE', ''));
  if ($template === '') return '';
  $url = strtr($template, [
    '{lat}' => rawurlencode((string)$lat),
    '{lon}' => rawurlencode((string)$lon),
  ]);
  if ($url === '') return '';
  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_TIMEOUT => 8,
    CURLOPT_HTTPHEADER => ['Accept: application/json'],
  ]);
  $body = curl_exec($ch);
  $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
  curl_close($ch);
  if ($status < 200 || $status >= 300 || !is_string($body) || trim($body) === '') return '';
  $data = json_decode($body, true);
  if (!is_array($data)) return '';
  $address = is_array($data['address'] ?? null) ? $data['address'] : [];
  foreach (['city', 'town', 'village', 'hamlet', 'municipality', 'county', 'state', 'country'] as $key) {
    $value = trim((string)($address[$key] ?? ''));
    if ($value !== '') return $value;
  }
  return trim((string)($data['display_name'] ?? ''));
}

function studio_process_media_item(int $mediaId): array {
  $pdo = studio_db();
  $stmt = $pdo->prepare('SELECT * FROM media_items WHERE id = :id LIMIT 1');
  $stmt->execute([':id' => $mediaId]);
  $row = $stmt->fetch();
  if (!$row) {
    throw new RuntimeException('Media non trovato');
  }
  $media = studio_media_row($row);
  $inputPath = (string)$media['storage_original_path'];
  if (!is_file($inputPath)) {
    throw new RuntimeException('File originale non trovato');
  }
  $pdo->prepare("UPDATE media_items SET processing_state = 'processing', error_text = '', updated_at = :updated_at WHERE id = :id")
    ->execute([':updated_at' => studio_now(), ':id' => $mediaId]);

  $metadata = studio_extract_media_metadata($inputPath, (string)$media['type']);
  $derivatives = (string)$media['type'] === 'video'
    ? studio_generate_video_derivatives($mediaId, (int)$media['project_id'], (int)$media['day_id'], $inputPath)
    : studio_generate_image_derivatives($mediaId, (int)$media['project_id'], (int)$media['day_id'], $inputPath);

  $placeLabel = '';
  if ($metadata['lat'] !== null && $metadata['lon'] !== null) {
    $placeLabel = studio_reverse_geocode((float)$metadata['lat'], (float)$metadata['lon']);
  }

  $update = $pdo->prepare("
    UPDATE media_items
    SET mime_type = :mime_type,
        processing_state = 'ready',
        storage_render_path = :storage_render_path,
        storage_thumb_path = :storage_thumb_path,
        storage_poster_path = :storage_poster_path,
        captured_at = :captured_at,
        place_label = :place_label,
        lat = :lat,
        lon = :lon,
        gps_inferred = 0,
        duration_sec = :duration_sec,
        metadata_json = :metadata_json,
        error_text = '',
        updated_at = :updated_at
    WHERE id = :id
  ");
  $update->execute([
    ':mime_type' => (string)$metadata['mime_type'],
    ':storage_render_path' => (string)$derivatives['storage_render_path'],
    ':storage_thumb_path' => (string)$derivatives['storage_thumb_path'],
    ':storage_poster_path' => (string)$derivatives['storage_poster_path'],
    ':captured_at' => (string)$metadata['captured_at'],
    ':place_label' => $placeLabel,
    ':lat' => $metadata['lat'],
    ':lon' => $metadata['lon'],
    ':duration_sec' => $metadata['duration_sec'],
    ':metadata_json' => json_encode($metadata['raw'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ':updated_at' => studio_now(),
    ':id' => $mediaId,
  ]);

  return studio_get_media($mediaId) ?? throw new RuntimeException('Media non trovato dopo il processing');
}

function studio_get_media(int $mediaId): ?array {
  $pdo = studio_db();
  $stmt = $pdo->prepare('SELECT * FROM media_items WHERE id = :id LIMIT 1');
  $stmt->execute([':id' => $mediaId]);
  $row = $stmt->fetch();
  return $row ? studio_media_row($row) : null;
}

function studio_refresh_day_processing_state(int $dayId): void {
  $pdo = studio_db();
  $mediaCounts = $pdo->query("
    SELECT
      SUM(CASE WHEN processing_state = 'error' THEN 1 ELSE 0 END) AS media_errors,
      SUM(CASE WHEN processing_state IN ('queued', 'processing') THEN 1 ELSE 0 END) AS media_pending
    FROM media_items
    WHERE day_id = " . (int)$dayId
  )->fetch() ?: [];
  $jobStmt = $pdo->prepare("
    SELECT
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS job_errors,
      SUM(CASE WHEN status IN ('queued', 'processing') THEN 1 ELSE 0 END) AS job_pending
    FROM jobs
    WHERE day_id = :day_id
  ");
  $jobStmt->execute([':day_id' => $dayId]);
  $jobCounts = $jobStmt->fetch() ?: [];
  $errors = (int)($mediaCounts['media_errors'] ?? 0) + (int)($jobCounts['job_errors'] ?? 0);
  $pending = (int)($mediaCounts['media_pending'] ?? 0) + (int)($jobCounts['job_pending'] ?? 0);
  $state = $errors > 0 ? 'error' : ($pending > 0 ? 'processing' : 'ready');
  $pdo->prepare('UPDATE project_days SET processing_state = :state, updated_at = :updated_at WHERE id = :id')
    ->execute([
      ':state' => $state,
      ':updated_at' => studio_now(),
      ':id' => $dayId,
    ]);
}

function studio_job_payload(array $job): array {
  $payload = json_decode((string)($job['payload_json'] ?? '{}'), true);
  return is_array($payload) ? $payload : [];
}

function studio_process_job(array $job): array {
  $jobType = (string)$job['job_type'];
  $payload = studio_job_payload($job);
  return match ($jobType) {
    'prepare_day' => ['day_id' => (int)($job['day_id'] ?? 0), 'prepared' => true, 'payload' => $payload],
    'publish_project' => ['project_id' => (int)($job['project_id'] ?? 0), 'published' => true],
    'process_media_uploads' => studio_process_media_job((int)($job['day_id'] ?? 0)),
    default => throw new RuntimeException('Job type non supportato: ' . $jobType),
  };
}

function studio_process_media_job(int $dayId): array {
  $pdo = studio_db();
  $stmt = $pdo->prepare("
    SELECT id
    FROM media_items
    WHERE day_id = :day_id AND processing_state IN ('queued', 'error')
    ORDER BY sort_order ASC, id ASC
  ");
  $stmt->execute([':day_id' => $dayId]);
  $ids = array_map(static fn(array $row): int => (int)$row['id'], $stmt->fetchAll());
  $processed = [];
  foreach ($ids as $mediaId) {
    try {
      $processed[] = studio_process_media_item($mediaId);
    } catch (Throwable $e) {
      $pdo->prepare("UPDATE media_items SET processing_state = 'error', error_text = :error_text, updated_at = :updated_at WHERE id = :id")
        ->execute([
          ':error_text' => $e->getMessage(),
          ':updated_at' => studio_now(),
          ':id' => $mediaId,
        ]);
    }
  }
  studio_refresh_day_processing_state($dayId);
  return [
    'day_id' => $dayId,
    'processed_count' => count($processed),
  ];
}

function studio_process_pending_jobs(?int $projectId = null, ?int $dayId = null, int $limit = 25): array {
  $pdo = studio_db();
  $sql = "SELECT * FROM jobs WHERE status = 'queued'";
  $params = [];
  if ($projectId !== null) {
    $sql .= ' AND project_id = :project_id';
    $params[':project_id'] = $projectId;
  }
  if ($dayId !== null) {
    $sql .= ' AND day_id = :day_id';
    $params[':day_id'] = $dayId;
  }
  $sql .= ' ORDER BY id ASC LIMIT ' . max(1, (int)$limit);
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $jobs = $stmt->fetchAll();
  $results = [];
  foreach ($jobs as $job) {
    $pdo->prepare("UPDATE jobs SET status = 'processing', started_at = :started_at WHERE id = :id")
      ->execute([':started_at' => studio_now(), ':id' => (int)$job['id']]);
    try {
      $result = studio_process_job($job);
      $pdo->prepare("
        UPDATE jobs
        SET status = 'done',
            result_json = :result_json,
            error_text = NULL,
            finished_at = :finished_at
        WHERE id = :id
      ")->execute([
        ':result_json' => json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ':finished_at' => studio_now(),
        ':id' => (int)$job['id'],
      ]);
      $results[] = ['job_id' => (int)$job['id'], 'status' => 'done', 'result' => $result];
    } catch (Throwable $e) {
      $pdo->prepare("
        UPDATE jobs
        SET status = 'failed',
            error_text = :error_text,
            finished_at = :finished_at
        WHERE id = :id
      ")->execute([
        ':error_text' => $e->getMessage(),
        ':finished_at' => studio_now(),
        ':id' => (int)$job['id'],
      ]);
      $results[] = ['job_id' => (int)$job['id'], 'status' => 'failed', 'error' => $e->getMessage()];
    }
    if ((int)($job['day_id'] ?? 0) > 0) {
      studio_refresh_day_processing_state((int)$job['day_id']);
    }
  }
  if ($dayId !== null && $dayId > 0) {
    studio_refresh_day_processing_state($dayId);
  }
  return [
    'processed_jobs' => count($results),
    'jobs' => $results,
  ];
}

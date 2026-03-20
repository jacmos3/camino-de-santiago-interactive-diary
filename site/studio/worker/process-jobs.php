<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/lib/bootstrap.php';
require_once dirname(__DIR__) . '/lib/store.php';
require_once dirname(__DIR__) . '/lib/media_processor.php';

$projectId = isset($argv[1]) ? (int)$argv[1] : null;
$dayId = isset($argv[2]) ? (int)$argv[2] : null;
$result = studio_process_pending_jobs($projectId > 0 ? $projectId : null, $dayId > 0 ? $dayId : null);
echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT) . PHP_EOL;

<?php
declare(strict_types=1);

$root = __DIR__;
$supportedLangs = ['it', 'en', 'es', 'fr'];
$prologueDates = ['2019-06-02', '2019-06-03'];
$prologueTrackDate = '2019-06-03';

function day_escape(string $value): string {
  return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function day_read_json(string $path, $fallback = null) {
  if (!is_file($path)) return $fallback;
  $raw = @file_get_contents($path);
  if ($raw === false || trim($raw) === '') return $fallback;
  $decoded = json_decode($raw, true);
  return is_array($decoded) ? $decoded : $fallback;
}

function day_detect_origin(): string {
  $proto = $_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '';
  $host = $_SERVER['HTTP_X_FORWARDED_HOST'] ?? ($_SERVER['HTTP_HOST'] ?? 'localhost');
  $proto = trim(explode(',', (string)$proto)[0] ?? '');
  $host = trim(explode(',', (string)$host)[0] ?? '');
  if ($proto === '') {
    $https = $_SERVER['HTTPS'] ?? '';
    $proto = (!empty($https) && strtolower((string)$https) !== 'off') ? 'https' : 'http';
  }
  if ($host === '') $host = 'localhost';
  return $proto . '://' . $host;
}

function day_build_absolute_url(string $origin, string $path): string {
  $origin = rtrim($origin, '/');
  $path = '/' . ltrim($path, '/');
  return $origin . $path;
}

function day_format_display_date(string $date, string $lang): string {
  $dt = DateTimeImmutable::createFromFormat('!Y-m-d', $date, new DateTimeZone('UTC'));
  if (!$dt) return $date;
  $fmtLocale = [
    'it' => 'it_IT.UTF-8',
    'en' => 'en_US.UTF-8',
    'es' => 'es_ES.UTF-8',
    'fr' => 'fr_FR.UTF-8',
  ][$lang] ?? 'it_IT.UTF-8';
  if (class_exists('IntlDateFormatter')) {
    $formatter = new IntlDateFormatter(
      str_replace('.UTF-8', '', $fmtLocale),
      IntlDateFormatter::FULL,
      IntlDateFormatter::NONE,
      'UTC',
      IntlDateFormatter::GREGORIAN,
      'EEEE d MMMM y'
    );
    if ($formatter) {
      $formatted = $formatter->format($dt);
      if (is_string($formatted) && $formatted !== '') return $formatted;
    }
  }
  return $date;
}

function day_truncate(string $text, int $maxLen = 160): string {
  $text = trim(preg_replace('/\s+/u', ' ', $text) ?? '');
  if ($text === '') return '';
  if (mb_strlen($text) <= $maxLen) return $text;
  return rtrim(mb_substr($text, 0, $maxLen - 1)) . '…';
}

function day_parse_note_sections(string $markdown): array {
  $lines = preg_split('/\r\n|\r|\n/', $markdown) ?: [];
  $sections = [];
  $currentHeading = null;
  $currentLines = [];
  $push = static function () use (&$sections, &$currentHeading, &$currentLines): void {
    if ($currentHeading === null) return;
    $body = trim(preg_replace('/\s+/u', ' ', implode(' ', $currentLines)) ?? '');
    $sections[] = ['heading' => $currentHeading, 'body' => $body];
  };
  foreach ($lines as $line) {
    $trimmed = trim((string)$line);
    if (preg_match('/^\*\*([^*]+)\*\*$/u', $trimmed, $m)) {
      $push();
      $currentHeading = trim((string)$m[1]);
      $currentLines = [];
      continue;
    }
    if ($currentHeading === null) continue;
    if ($trimmed !== '') $currentLines[] = $trimmed;
  }
  $push();
  return $sections;
}

function day_first_sentence(string $text): string {
  $text = trim(preg_replace('/\s+/u', ' ', $text) ?? '');
  if ($text === '') return '';
  if (preg_match('/^(.+?[.!?])(?:\s|$)/u', $text, $m)) {
    return trim((string)$m[1]);
  }
  return $text;
}

function day_media_path(array $item, string $field, string $fallbackDate = ''): string {
  $raw = trim((string)($item[$field] ?? ''));
  if ($raw === '') return '';
  if (preg_match('#^(?:[a-z]+:)?//#i', $raw) || str_starts_with($raw, 'data:') || str_starts_with($raw, 'blob:')) {
    return $raw;
  }
  $date = substr((string)($item['date'] ?? $fallbackDate), 0, 10);
  $normalized = str_starts_with($raw, '/') ? $raw : '/' . ltrim(preg_replace('#^\.?/#', '', $raw) ?? $raw, '/');
  if (preg_match('#^/assets/(img|thumb|poster|video_resized)/\d{4}-\d{2}-\d{2}/[^/]+$#i', $normalized)) {
    return $normalized;
  }
  $fileName = basename($normalized);
  $kindFromField = $field === 'src'
    ? (((string)($item['type'] ?? '') === 'video') ? 'video_resized' : 'img')
    : ($field === 'thumb' ? 'thumb' : 'poster');
  if ($date !== '' && $fileName !== '') {
    return "/assets/{$kindFromField}/{$date}/{$fileName}";
  }
  return $normalized;
}

function day_resolve_og_path(array $day, array $overrides): string {
  $date = substr((string)($day['date'] ?? ''), 0, 10);
  $overrideId = trim((string)($overrides[$date] ?? ''));
  if ($overrideId === '') return '/assets/og-image.jpg';
  $items = is_array($day['items'] ?? null) ? $day['items'] : [];
  foreach ($items as $item) {
    if (trim((string)($item['id'] ?? '')) !== $overrideId) continue;
    if ((string)($item['type'] ?? '') === 'video') {
      return day_media_path($item, 'poster', $date)
        ?: day_media_path($item, 'thumb', $date)
        ?: '/assets/og-image.jpg';
    }
    return day_media_path($item, 'src', $date)
      ?: day_media_path($item, 'thumb', $date)
      ?: '/assets/og-image.jpg';
  }
  return '/assets/og-image.jpg';
}

function day_markdown_to_html(string $markdown): string {
  $lines = preg_split('/\r\n|\r|\n/u', $markdown) ?: [];
  $html = [];
  $paragraph = [];

  $flushParagraph = static function () use (&$paragraph, &$html): void {
    if (!$paragraph) return;
    $text = trim(implode(' ', $paragraph));
    if ($text !== '') {
      $html[] = '<p>' . day_escape($text) . '</p>';
    }
    $paragraph = [];
  };

  foreach ($lines as $line) {
    $trimmed = trim((string)$line);
    if ($trimmed === '') {
      $flushParagraph();
      continue;
    }
    if (preg_match('/^\*\*([^*]+)\*\*$/u', $trimmed, $m)) {
      $flushParagraph();
      $html[] = '<h2>' . day_escape(trim((string)$m[1])) . '</h2>';
      continue;
    }
    $paragraph[] = $trimmed;
  }

  $flushParagraph();
  return implode("\n", $html);
}

function day_merge_prologue(array $days, array $prologueDates, string $trackDate): ?array {
  $source = array_values(array_filter($days, static function ($day) use ($prologueDates): bool {
    return in_array((string)($day['date'] ?? ''), $prologueDates, true);
  }));
  if (!$source) return null;
  $notes = implode("\n\n", array_values(array_filter(array_map(static function ($day): string {
    return trim((string)($day['notes'] ?? ''));
  }, $source))));
  $items = [];
  $recommendationsMap = [];
  foreach ($source as $day) {
    foreach ((is_array($day['items'] ?? null) ? $day['items'] : []) as $item) {
      if (!is_array($item)) continue;
      if (!isset($item['date']) || (string)$item['date'] === '') {
        $item['date'] = (string)($day['date'] ?? '');
      }
      $items[] = $item;
    }
    foreach ((is_array($day['recommendations'] ?? null) ? $day['recommendations'] : []) as $rec) {
      $key = json_encode($rec, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
      if ($key !== false) $recommendationsMap[$key] = $rec;
    }
  }
  usort($items, static function (array $a, array $b): int {
    $left = ((string)($a['date'] ?? '')) . ' ' . ((string)($a['time'] ?? '')) . ' ' . ((string)($a['orig'] ?? ''));
    $right = ((string)($b['date'] ?? '')) . ' ' . ((string)($b['time'] ?? '')) . ' ' . ((string)($b['orig'] ?? ''));
    return $left <=> $right;
  });
  return [
    'date' => $trackDate,
    'notes' => $notes,
    'recommendations' => array_values($recommendationsMap),
    'items' => $items,
  ];
}

function day_build_prologue_narrative(string $lang): string {
  if ($lang === 'en') {
    return implode("\n", [
      '**Title**',
      'Prologue: leaving before leaving.',
      '',
      '**Where I was / stage**',
      'June 2 and 3 were the approach days: from Perugia to Bergamo, then an evening flight to Lourdes.',
      '',
      '**Key scene**',
      'The Camino started before the trail. On June 2 I went from Perugia to Milan with a friend who was heading to Milan that same day; along the way we had picked up other people through BlaBlaCar, and the trip passed quickly through interesting conversations. Then I continued from Milan to Bergamo by train to reach friends who would host me for one night. For the Camino I had considered bringing a tent, but in the hours right before departure, while I was packing my backpack, I realized it would be too bulky and heavy for the backpack balance, so I did not bring it and kept only the sleeping bag in my backpack. On the morning of June 3, in Bergamo, I went for a bike ride: light air, slow pace, and at the end of a path, near a stagnant stretch of the Brembo River, I encountered donkeys. In the evening I took the flight: I landed in Lourdes late and had not organized accommodation. I could not find a place to sleep, and every place I reached was already closed or had no reception. It was objectively worrying because I really had nowhere to stay for the night, but I was not anxious at all: I had the sleeping bag and had no problem sleeping outside, homeless style. From that point on, it was no longer preparation, it was the real start.',
      '',
      '**What I understood**',
      'The first step of the Camino does not coincide with the first kilometer on foot: it begins in logistical choices, in waiting, and in the way you prepare yourself for the journey.',
      '',
      '**Practical note**',
      'Transfer Perugia-Milan by BlaBlaCar, Milan-Bergamo by train, night in Bergamo hosted by friends, then evening flight on June 3.'
    ]);
  }
  if ($lang === 'es') {
    return implode("\n", [
      '**Título**',
      'Prólogo: partir antes de partir.',
      '',
      '**Dónde estaba / etapa**',
      'El 2 y el 3 de junio fueron los días de aproximación: de Perugia a Bérgamo, luego vuelo nocturno hacia Lourdes.',
      '',
      '**Escena clave**',
      'El camino empezó antes del sendero. El 2 de junio hice Perugia-Milán con un amigo que iba a Milán ese mismo día; durante el viaje habíamos recogido a otras personas con BlaBlaCar y el trayecto pasó rápido entre conversaciones interesantes. Luego seguí de Milán a Bérgamo en tren para llegar a unos amigos que me alojarían una noche. Para el camino había pensado llevar tienda, pero en las horas previas a la salida, justo mientras preparaba la mochila, entendí que sería demasiado voluminosa y pesada para el equilibrio de la mochila, así que no la llevé, dejando en la mochila solo el saco de dormir. La mañana del 3, en Bérgamo, di una vuelta en bici: aire ligero, ritmo lento, y al final de un sendero, cerca de un estancamiento del río Brembo, me encontré con unos burros. Por la tarde tomé el vuelo: aterricé en Lourdes tarde y no había organizado alojamiento. No conseguía encontrar dónde dormir y los sitios que encontraba, cuando llegaba, estaban todos cerrados o sin recepción. Era preocupante, porque no tenía realmente dónde pasar la noche, pero no estaba nada ansioso: tenía el saco de dormir y no tenía ningún problema en dormir fuera, homeless style. Desde ahí ya no era preparación, era el inicio real.',
      '',
      '**Una cosa que entendí**',
      'El primer paso del camino no coincide con el primer kilómetro a pie: empieza en las decisiones logísticas, en la espera y en cómo te preparas para el viaje.',
      '',
      '**Nota práctica**',
      'Traslado Perugia-Milán con BlaBlaCar, tren Milán-Bérgamo, noche en Bérgamo con amigos y luego vuelo nocturno del 3 de junio.'
    ]);
  }
  if ($lang === 'fr') {
    return implode("\n", [
      '**Titre**',
      'Prologue : partir avant de partir.',
      '',
      '**Où j’étais / étape**',
      'Les 2 et 3 juin ont été les jours d’approche : de Pérouse à Bergame, puis vol du soir vers Lourdes.',
      '',
      '**Scène clé**',
      'Le chemin a commencé avant le sentier. Le 2 juin, j’ai fait Pérouse-Milan avec un ami qui allait à Milan ce jour-là ; pendant le trajet, nous avions pris d’autres personnes via BlaBlaCar, et le voyage est passé vite entre discussions intéressantes. Ensuite, j’ai continué de Milan à Bergame en train pour rejoindre des amis qui m’hébergeaient une nuit. Pour le chemin, j’avais envisagé d’emporter une tente, mais dans les heures avant le départ, au moment de préparer mon sac, j’ai compris qu’elle serait trop encombrante et trop lourde pour l’équilibre du sac ; je ne l’ai donc pas prise, en gardant seulement le sac de couchage dans le sac. Le matin du 3, à Bergame, j’ai fait un tour à vélo : air léger, rythme lent, et au bout d’un sentier, près d’une retenue stagnante de la rivière Brembo, j’ai croisé des ânes. Le soir, j’ai pris l’avion : je suis arrivé tard à Lourdes et je n’avais pas organisé d’hébergement. Je n’arrivais pas à trouver où dormir et les lieux que je trouvais, une fois sur place, étaient déjà fermés ou sans réception. C’était inquiétant, parce que je n’avais pas réellement d’endroit pour la nuit, mais je n’étais pas du tout anxieux : j’avais le sac de couchage et je n’avais aucun problème à dormir dehors, homeless style. À partir de là, ce n’était plus de la préparation, c’était le vrai début.',
      '',
      '**Ce que j’ai compris**',
      'Le premier pas du chemin ne coïncide pas avec le premier kilomètre à pied : il commence dans les choix logistiques, dans l’attente et dans la manière de se disposer au voyage.',
      '',
      '**Note pratique**',
      'Trajet Pérouse-Milan en BlaBlaCar, train Milan-Bergame, nuit à Bergame chez des amis, puis vol du soir du 3 juin.'
    ]);
  }
  return implode("\n", [
    '**Titolo**',
    'Prologo: partire prima di partire.',
    '',
    '**Dove ero / tappa**',
    'Il 2 e il 3 giugno sono stati i giorni di avvicinamento: da Perugia a Bergamo, poi volo serale verso Lourdes.',
    '',
    '**Scena chiave**',
    'Il cammino è iniziato prima del sentiero. Il 2 giugno ho fatto Perugia-Milano con un mio amico che andava a Milano proprio quel giorno; lungo il viaggio avevamo caricato altre persone su BlaBlaCar e il tragitto è passato veloce tra chiacchiere interessanti. Poi ho proseguito da Milano a Bergamo in treno per raggiungere amici che mi avrebbero ospitato una notte. Per il cammino avevo considerato di portare la tenda, ma nelle ore precedenti alla partenza, proprio mentre stavo preparando lo zaino, ho capito che sarebbe stata troppo ingombrante e pesante per l’equilibrio dello zaino, quindi non l’ho portata, tenendo nello zaino solo il sacco a pelo. Il 3 mattina, a Bergamo, ho fatto un giro in bici: aria leggera, ritmo lento, e alla fine di un sentiero, vicino a un ristagnamento del fiume Brembo, ho incontrato degli asini. In serata ho preso il volo: sono atterrato a Lourdes tardi e non avevo organizzato l’alloggio. Non riuscivo a trovare posto per dormire e i posti che trovavo, una volta arrivato lì, erano già tutti chiusi o senza reception. Era una cosa preoccupante, perché non avevo realmente un posto dove stare la notte, ma non ero per nulla in ansia: avevo il sacco a pelo e non avevo alcun problema a dormire fuori, homeless style. Da lì in poi non era più preparazione, era inizio vero.',
    '',
    '**Una cosa che ho capito**',
    'Il primo passo del cammino non coincide con il primo chilometro a piedi: comincia nelle scelte logistiche, nell’attesa e nel modo in cui ti predisponi al viaggio.',
    '',
    '**Nota pratica**',
    'Trasferimento Perugia-Milano con BlaBlaCar, treno Milano-Bergamo, notte a Bergamo da amici, poi volo serale del 3 giugno.'
  ]);
}

$ui = [
  'it' => [
    'title_prefix' => 'Diario Cammino',
    'default_description' => static fn(string $date): string => "Pagina diario del Cammino di Santiago per il {$date}: foto, video, GPS e note del giorno.",
    'back_to_diary' => 'Torna al diario',
    'open_interactive_diary' => 'Apri nel diario interattivo',
    'open_map' => 'Apri mappa',
    'day_notes' => 'Note del giorno',
    'no_notes' => 'Nessuna nota disponibile.',
    'media_heading' => 'Media',
    'no_media' => 'Nessun media per questo giorno.',
    'comments' => 'Commenti',
    'close' => 'Chiudi',
    'prev' => 'Precedente',
    'next' => 'Successivo',
    'zoom_out' => 'Riduci zoom',
    'zoom_in' => 'Aumenta zoom',
    'name' => 'Nome',
    'write_comment' => 'Scrivi un commento',
    'send' => 'Invia',
    'comments_empty' => 'Nessun commento per ora.',
    'comments_loading' => 'Caricamento commenti...',
    'comments_load_error' => 'Errore nel caricamento commenti',
    'comments_save_error' => 'Errore durante il salvataggio commento',
    'comments_on_day' => 'Commenti sulla nota del giorno',
    'comments_on_media' => 'Commenti sul media',
    'recommendations' => 'Posti consigliati',
    'prologue_label' => 'Prologo (2–3 giugno)',
  ],
  'en' => [
    'title_prefix' => 'Camino Diary',
    'default_description' => static fn(string $date): string => "Camino de Santiago diary entry for {$date}: photos, videos, GPS and daily notes.",
    'back_to_diary' => 'Back to diary',
    'open_interactive_diary' => 'Open in interactive diary',
    'open_map' => 'Open map',
    'day_notes' => 'Day notes',
    'no_notes' => 'No notes available.',
    'media_heading' => 'Media',
    'no_media' => 'No media for this day.',
    'comments' => 'Comments',
    'close' => 'Close',
    'prev' => 'Previous',
    'next' => 'Next',
    'zoom_out' => 'Zoom out',
    'zoom_in' => 'Zoom in',
    'name' => 'Name',
    'write_comment' => 'Write a comment',
    'send' => 'Send',
    'comments_empty' => 'No comments yet.',
    'comments_loading' => 'Loading comments...',
    'comments_load_error' => 'Failed to load comments',
    'comments_save_error' => 'Failed to save comment',
    'comments_on_day' => 'Comments on day note',
    'comments_on_media' => 'Comments on media',
    'recommendations' => 'Recommended places',
    'prologue_label' => 'Prologue (June 2–3)',
  ],
  'es' => [
    'title_prefix' => 'Diario del Camino',
    'default_description' => static fn(string $date): string => "Página del diario del Camino de Santiago para {$date}: fotos, vídeos, GPS y notas del día.",
    'back_to_diary' => 'Volver al diario',
    'open_interactive_diary' => 'Abrir en el diario interactivo',
    'open_map' => 'Abrir mapa',
    'day_notes' => 'Notas del día',
    'no_notes' => 'No hay notas disponibles.',
    'media_heading' => 'Media',
    'no_media' => 'No hay media para este día.',
    'comments' => 'Comentarios',
    'close' => 'Cerrar',
    'prev' => 'Anterior',
    'next' => 'Siguiente',
    'zoom_out' => 'Alejar zoom',
    'zoom_in' => 'Acercar zoom',
    'name' => 'Nombre',
    'write_comment' => 'Escribe un comentario',
    'send' => 'Enviar',
    'comments_empty' => 'Aún no hay comentarios.',
    'comments_loading' => 'Cargando comentarios...',
    'comments_load_error' => 'Error al cargar comentarios',
    'comments_save_error' => 'Error al guardar el comentario',
    'comments_on_day' => 'Comentarios sobre la nota del día',
    'comments_on_media' => 'Comentarios sobre el media',
    'recommendations' => 'Lugares recomendados',
    'prologue_label' => 'Prólogo (2–3 de junio)',
  ],
  'fr' => [
    'title_prefix' => 'Journal du Chemin',
    'default_description' => static fn(string $date): string => "Page du journal du Chemin de Saint-Jacques pour le {$date} : photos, vidéos, GPS et notes du jour.",
    'back_to_diary' => 'Retour au journal',
    'open_interactive_diary' => 'Ouvrir dans le journal interactif',
    'open_map' => 'Ouvrir la carte',
    'day_notes' => 'Notes du jour',
    'no_notes' => 'Aucune note disponible.',
    'media_heading' => 'Médias',
    'no_media' => 'Aucun média pour ce jour.',
    'comments' => 'Commentaires',
    'close' => 'Fermer',
    'prev' => 'Précédent',
    'next' => 'Suivant',
    'zoom_out' => 'Zoom arrière',
    'zoom_in' => 'Zoom avant',
    'name' => 'Nom',
    'write_comment' => 'Écrire un commentaire',
    'send' => 'Envoyer',
    'comments_empty' => 'Aucun commentaire pour le moment.',
    'comments_loading' => 'Chargement des commentaires...',
    'comments_load_error' => 'Erreur de chargement des commentaires',
    'comments_save_error' => 'Erreur lors de l’enregistrement du commentaire',
    'comments_on_day' => 'Commentaires sur la note du jour',
    'comments_on_media' => 'Commentaires sur le média',
    'recommendations' => 'Lieux conseillés',
    'prologue_label' => 'Prologue (2–3 juin)',
  ],
];

$lang = strtolower(trim((string)($_GET['lang'] ?? 'it')));
$date = trim((string)($_GET['date'] ?? ''));

if (!in_array($lang, $supportedLangs, true)) $lang = 'it';
$isPrologue = ($date === 'prologue');
if (!$isPrologue && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
  http_response_code(404);
  echo 'Not found';
  exit;
}

$entriesPath = "{$root}/data/entries.{$lang}.json";
$entries = day_read_json($entriesPath, ['days' => []]);
$days = is_array($entries['days'] ?? null) ? $entries['days'] : [];
$index = -1;
$day = null;
$prevDay = null;
$nextDay = null;
if ($isPrologue) {
  $day = day_merge_prologue($days, $prologueDates, $prologueTrackDate);
  if (is_array($day)) {
    $day['notes'] = day_build_prologue_narrative($lang);
  }
  foreach ($days as $candidate) {
    $candidateDate = (string)($candidate['date'] ?? '');
    if (!in_array($candidateDate, $prologueDates, true)) {
      $nextDay = $candidate;
      break;
    }
  }
  if (!is_array($day)) {
    http_response_code(404);
    echo 'Not found';
    exit;
  }
} else {
  foreach ($days as $i => $candidate) {
    if ((string)($candidate['date'] ?? '') === $date) {
      $index = (int)$i;
      break;
    }
  }

  if ($index < 0) {
    http_response_code(404);
    echo 'Not found';
    exit;
  }

  $day = $days[$index];
  $prevDay = $index > 0 ? $days[$index - 1] : null;
  $nextDay = $index < count($days) - 1 ? $days[$index + 1] : null;
}
$origin = day_detect_origin();
$uiLang = $ui[$lang] ?? $ui['it'];
$effectiveDate = $isPrologue ? $prologueTrackDate : $date;
$displayDate = $isPrologue ? (string)$uiLang['prologue_label'] : day_format_display_date($date, $lang);
$sections = day_parse_note_sections((string)($day['notes'] ?? ''));
$seoTitleCore = trim((string)($sections[0]['body'] ?? ''));
$seoTitle = $seoTitleCore !== ''
  ? "{$seoTitleCore} | {$displayDate} | {$uiLang['title_prefix']}"
  : ($isPrologue ? "{$displayDate} | {$uiLang['title_prefix']}" : "{$uiLang['title_prefix']} · {$date}");
$seoDescription = day_truncate(implode(' — ', array_filter([
  trim((string)($sections[0]['body'] ?? '')),
  trim((string)($sections[1]['body'] ?? '')),
  day_first_sentence((string)($sections[2]['body'] ?? '')),
])), 160);
if ($seoDescription === '') {
  $defaultDescription = $uiLang['default_description'];
  $seoDescription = $defaultDescription($effectiveDate);
}

$overrides = day_read_json("{$root}/data/day_og_overrides.json", []);
if (!is_array($overrides)) $overrides = [];
$ogImagePath = day_resolve_og_path($day, $overrides);
$ogImageUrl = day_build_absolute_url($origin, $ogImagePath);
$canonicalUrl = day_build_absolute_url($origin, $isPrologue ? "/{$lang}/prologue/" : "/{$lang}/day/{$date}/");
$dayNotesHtml = day_markdown_to_html((string)($day['notes'] ?? ''));
$recommendations = is_array($day['recommendations'] ?? null) ? $day['recommendations'] : [];
$items = is_array($day['items'] ?? null) ? $day['items'] : [];
$interactiveDiaryHref = $isPrologue ? "/{$lang}/?day=prologue" : "/{$lang}/?day={$date}";
$headerTitle = $isPrologue ? $displayDate : "{$displayDate} ({$date})";
$commentTargetDate = $isPrologue ? $prologueTrackDate : $date;

http_response_code(200);
?><!doctype html>
<html lang="<?= day_escape($lang) ?>">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title><?= day_escape($seoTitle) ?></title>
  <meta name="description" content="<?= day_escape($seoDescription) ?>" />
  <meta name="robots" content="index,follow,max-image-preview:large" />
  <link rel="canonical" href="<?= day_escape($canonicalUrl) ?>" />
  <link rel="alternate" hreflang="it" href="<?= day_escape(day_build_absolute_url($origin, $isPrologue ? '/it/prologue/' : "/it/day/{$date}/")) ?>" />
  <link rel="alternate" hreflang="en" href="<?= day_escape(day_build_absolute_url($origin, $isPrologue ? '/en/prologue/' : "/en/day/{$date}/")) ?>" />
  <link rel="alternate" hreflang="es" href="<?= day_escape(day_build_absolute_url($origin, $isPrologue ? '/es/prologue/' : "/es/day/{$date}/")) ?>" />
  <link rel="alternate" hreflang="fr" href="<?= day_escape(day_build_absolute_url($origin, $isPrologue ? '/fr/prologue/' : "/fr/day/{$date}/")) ?>" />
  <link rel="alternate" hreflang="x-default" href="<?= day_escape(day_build_absolute_url($origin, $isPrologue ? '/it/prologue/' : "/it/day/{$date}/")) ?>" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="<?= day_escape($seoTitle) ?>" />
  <meta property="og:description" content="<?= day_escape($seoDescription) ?>" />
  <meta property="og:url" content="<?= day_escape($canonicalUrl) ?>" />
  <meta property="og:image" content="<?= day_escape($ogImageUrl) ?>" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:type" content="image/jpeg" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="<?= day_escape($seoTitle) ?>" />
  <meta name="twitter:description" content="<?= day_escape($seoDescription) ?>" />
  <meta name="twitter:image" content="<?= day_escape($ogImageUrl) ?>" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="icon" href="/favicon.ico" sizes="any" />
  <link rel="icon" type="image/png" href="/favicon.png" />
  <link rel="stylesheet" href="/styles.css" />
  <style>
    body{max-width:1100px;margin:0 auto;padding:24px}
    .day-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
    .day-nav{display:flex;gap:12px;flex-wrap:wrap}
    .day-nav a,.back-link{display:inline-block;padding:8px 12px;border-radius:12px;background:#ece7df;color:#2d2823;text-decoration:none}
    .day-section{margin-top:18px;background:#fff;border-radius:16px;padding:16px}
    .media-grid{margin-top:16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
    .media-card{background:#f7f3ee;border-radius:12px;padding:8px;display:flex;flex-direction:column;gap:6px}
    .media-card img{width:100%;height:180px;object-fit:cover;border-radius:10px;display:block}
    .media-card__meta{font-size:12px;line-height:1.35;color:#5a5248;word-break:break-word}
    .day-modal,.day-comments-modal{position:fixed;inset:0;display:none;z-index:9999}
    .day-modal.is-open,.day-comments-modal.is-open{display:block}
    .day-modal__backdrop,.day-comments-modal__backdrop{position:absolute;inset:0;background:rgba(13,11,10,.7)}
    .day-modal__dialog,.day-comments-modal__dialog{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(92vw,980px);max-height:90vh;background:#faf6f1;border-radius:14px;padding:12px;overflow:auto}
    .day-modal__close,.day-comments-modal__close{position:absolute;right:10px;top:8px;border:0;background:transparent;font-size:34px;line-height:1;cursor:pointer;color:#4a433a}
    .day-modal__nav{position:absolute;top:50%;transform:translateY(-50%);z-index:2;border:0;background:rgba(31,26,22,.66);color:#fffaf2;width:34px;height:44px;border-radius:10px;cursor:pointer;font-size:24px;line-height:1}
    .day-modal__nav--prev{left:10px}
    .day-modal__nav--next{right:10px}
    .day-modal__meta{margin:0 36px 10px 2px;font-size:13px;color:#5a5248}
    .day-modal__body img,.day-modal__body video{display:block;width:100%;max-height:75vh;object-fit:contain;border-radius:10px;background:#111}
    .day-comments-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
    .day-comment-btn{border:1px solid rgba(31,26,22,.2);background:#fffaf2;color:#2d2823;border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer}
    .day-comment-btn--media{align-self:flex-end}
    .day-comments-list{display:flex;flex-direction:column;gap:10px}
    .day-comment-item{background:#fff;border:1px solid rgba(31,26,22,.08);border-radius:10px;padding:9px 10px}
    .day-comment-meta{font-size:12px;color:#746a60;margin-bottom:4px}
    .day-comment-text{white-space:pre-wrap;line-height:1.4;color:#2d2823}
    .day-comments-form{margin-top:12px;display:flex;flex-direction:column;gap:8px}
    .day-comments-form input,.day-comments-form textarea{width:100%;border:1px solid rgba(31,26,22,.2);border-radius:8px;padding:8px 9px;background:#fffaf2;color:#2d2823}
    .day-comments-form textarea{min-height:84px;resize:vertical}
    .day-comments-form button{align-self:flex-end;border:1px solid rgba(31,26,22,.2);background:#2d2823;color:#fffaf2;border-radius:8px;padding:8px 12px;cursor:pointer}
    .day-comments-state{color:#746a60;font-size:13px}
  </style>
</head>
<body>
  <header class="day-head">
    <div>
      <p><a class="back-link" href="/<?= day_escape($lang) ?>/"><?= day_escape($uiLang['back_to_diary']) ?></a></p>
      <h1><?= day_escape($headerTitle) ?></h1>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="back-link" href="<?= day_escape($interactiveDiaryHref) ?>"><?= day_escape($uiLang['open_interactive_diary']) ?></a>
        <a class="back-link" href="/<?= day_escape($lang) ?>/map/"><?= day_escape($uiLang['open_map']) ?></a>
      </div>
    </div>
    <nav class="day-nav">
      <?php if (is_array($prevDay)): ?><a href="/<?= day_escape($lang) ?>/day/<?= day_escape((string)$prevDay['date']) ?>/">← <?= day_escape((string)$prevDay['date']) ?></a><?php endif; ?>
      <?php if (is_array($nextDay)): ?><a href="/<?= day_escape($lang) ?>/day/<?= day_escape((string)$nextDay['date']) ?>/"><?= day_escape((string)$nextDay['date']) ?> →</a><?php endif; ?>
    </nav>
  </header>

  <section class="day-section">
    <div class="day-comments-head">
      <h2><?= day_escape($uiLang['day_notes']) ?></h2>
      <button type="button" class="day-comment-btn" data-comment-target="note-<?= day_escape($commentTargetDate) ?>"><?= day_escape($uiLang['comments']) ?></button>
    </div>
    <?= $dayNotesHtml !== '' ? $dayNotesHtml : '<p>' . day_escape($uiLang['no_notes']) . '</p>' ?>
  </section>

  <?php if ($recommendations): ?>
  <section class="day-section">
    <h2><?= day_escape($uiLang['recommendations']) ?></h2>
    <ul>
      <?php foreach ($recommendations as $rec): ?>
        <li><?= day_escape((string)$rec) ?></li>
      <?php endforeach; ?>
    </ul>
  </section>
  <?php endif; ?>

  <section class="day-section">
    <h2><?= day_escape($uiLang['media_heading']) ?> (<?= count($items) ?>)</h2>
    <div class="media-grid">
      <?php if (!$items): ?>
        <p><?= day_escape($uiLang['no_media']) ?></p>
      <?php endif; ?>
      <?php foreach ($items as $item):
        $mediaId = trim((string)($item['id'] ?? ''));
        if ($mediaId === '') continue;
        $isVideo = ((string)($item['type'] ?? '') === 'video');
        $preview = $isVideo
          ? (day_media_path($item, 'poster', $date) ?: day_media_path($item, 'thumb', $date) ?: day_media_path($item, 'src', $date))
          : (day_media_path($item, 'thumb', $date) ?: day_media_path($item, 'src', $date));
        $src = day_media_path($item, 'src', $date) ?: $preview;
        $poster = day_media_path($item, 'poster', $date) ?: $preview;
        $meta = implode(' · ', array_filter([(string)($item['time'] ?? ''), (string)($item['place'] ?? '')]));
      ?>
      <article class="media-card">
        <a class="day-media-link"
           href="<?= day_escape($src) ?>"
           data-media-type="<?= $isVideo ? 'video' : 'image' ?>"
           data-media-src="<?= day_escape($src) ?>"
           data-media-poster="<?= day_escape($poster) ?>"
           data-media-meta="<?= day_escape($meta) ?>">
          <img src="<?= day_escape($preview) ?>" alt="<?= day_escape($mediaId) ?>" loading="lazy" />
        </a>
        <button type="button" class="day-comment-btn day-comment-btn--media" data-comment-target="media-<?= day_escape($mediaId) ?>"><?= day_escape($uiLang['comments']) ?></button>
        <div class="media-card__meta"><?= day_escape($meta) ?></div>
      </article>
      <?php endforeach; ?>
    </div>
  </section>

  <div class="day-modal" id="day-media-modal" aria-hidden="true">
    <div class="day-modal__backdrop" id="day-media-backdrop"></div>
    <div class="day-modal__dialog" role="dialog" aria-modal="true" aria-label="Media">
      <button type="button" class="day-modal__close" id="day-media-close" aria-label="<?= day_escape($uiLang['close']) ?>">×</button>
      <button type="button" class="day-modal__nav day-modal__nav--prev" id="day-media-prev" aria-label="<?= day_escape($uiLang['prev']) ?>">‹</button>
      <button type="button" class="day-modal__nav day-modal__nav--next" id="day-media-next" aria-label="<?= day_escape($uiLang['next']) ?>">›</button>
      <p class="day-modal__meta" id="day-media-meta"></p>
      <div class="day-modal__body" id="day-media-body"></div>
    </div>
  </div>

  <div class="day-comments-modal" id="day-comments-modal" aria-hidden="true">
    <div class="day-comments-modal__backdrop" id="day-comments-backdrop"></div>
    <div class="day-comments-modal__dialog" role="dialog" aria-modal="true" aria-label="<?= day_escape($uiLang['comments']) ?>">
      <button type="button" class="day-comments-modal__close" id="day-comments-close" aria-label="<?= day_escape($uiLang['close']) ?>">×</button>
      <h3 class="day-comments-modal__title" id="day-comments-title"><?= day_escape($uiLang['comments']) ?></h3>
      <div class="day-comments-list" id="day-comments-list"></div>
      <form class="day-comments-form" id="day-comments-form">
        <input id="day-comments-author" type="text" maxlength="80" placeholder="<?= day_escape($uiLang['name']) ?>" required />
        <textarea id="day-comments-text" maxlength="1200" placeholder="<?= day_escape($uiLang['write_comment']) ?>" required></textarea>
        <button type="submit"><?= day_escape($uiLang['send']) ?></button>
      </form>
    </div>
  </div>

  <script>
    (function () {
      const modal = document.getElementById('day-media-modal');
      const body = document.getElementById('day-media-body');
      const meta = document.getElementById('day-media-meta');
      const closeBtn = document.getElementById('day-media-close');
      const backdrop = document.getElementById('day-media-backdrop');
      const prevBtn = document.getElementById('day-media-prev');
      const nextBtn = document.getElementById('day-media-next');
      const links = Array.from(document.querySelectorAll('.day-media-link'));
      let activeIndex = -1;

      const openModal = (index) => {
        const link = links[index];
        if (!link) return;
        activeIndex = index;
        const type = link.getAttribute('data-media-type') || 'image';
        const src = link.getAttribute('data-media-src') || '';
        const poster = link.getAttribute('data-media-poster') || '';
        const metaText = link.getAttribute('data-media-meta') || '';
        body.innerHTML = '';
        if (type === 'video') {
          const v = document.createElement('video');
          v.controls = true;
          v.autoplay = true;
          v.playsInline = true;
          v.preload = 'metadata';
          v.src = src;
          if (poster) v.poster = poster;
          body.appendChild(v);
        } else {
          const img = document.createElement('img');
          img.loading = 'eager';
          img.src = src;
          img.alt = metaText || '';
          body.appendChild(img);
        }
        meta.textContent = metaText || '';
        modal.classList.add('is-open');
        modal.setAttribute('aria-hidden', 'false');
      };

      const closeModal = () => {
        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');
        body.innerHTML = '';
        activeIndex = -1;
      };

      const openByOffset = (offset) => {
        if (!links.length) return;
        const base = activeIndex < 0 ? 0 : activeIndex;
        const next = (base + offset + links.length) % links.length;
        openModal(next);
      };

      links.forEach((link, idx) => {
        link.addEventListener('click', (event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button === 1) return;
          event.preventDefault();
          openModal(idx);
        });
      });

      closeBtn.addEventListener('click', closeModal);
      backdrop.addEventListener('click', closeModal);
      prevBtn.addEventListener('click', () => openByOffset(-1));
      nextBtn.addEventListener('click', () => openByOffset(1));
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeModal();
        if (!modal.classList.contains('is-open')) return;
        if (event.key === 'ArrowLeft') openByOffset(-1);
        if (event.key === 'ArrowRight') openByOffset(1);
      });

      const commentsModal = document.getElementById('day-comments-modal');
      const commentsBackdrop = document.getElementById('day-comments-backdrop');
      const commentsClose = document.getElementById('day-comments-close');
      const commentsTitle = document.getElementById('day-comments-title');
      const commentsList = document.getElementById('day-comments-list');
      const commentsForm = document.getElementById('day-comments-form');
      const commentsAuthor = document.getElementById('day-comments-author');
      const commentsText = document.getElementById('day-comments-text');
      const AUTHOR_KEY = 'cammino_comment_author_v1';
      let activeCommentTarget = '';

      const escapeHtml = (value) => String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');

      const renderComments = (items, stateText) => {
        if (!commentsList) return;
        if (stateText) {
          commentsList.innerHTML = '<div class="day-comments-state">' + escapeHtml(stateText) + '</div>';
          return;
        }
        const arr = Array.isArray(items) ? items : [];
        if (!arr.length) {
          commentsList.innerHTML = '<div class="day-comments-state"><?= day_escape($uiLang['comments_empty']) ?></div>';
          return;
        }
        commentsList.innerHTML = arr.map((c) => (
          '<article class="day-comment-item">' +
            '<div class="day-comment-meta">' + escapeHtml(c.author || '') + ' · ' + escapeHtml(String(c.created_at || '').replace('T', ' ').slice(0, 16)) + '</div>' +
            '<div class="day-comment-text">' + escapeHtml(c.text || '') + '</div>' +
          '</article>'
        )).join('');
      };

      const openComments = async (target) => {
        activeCommentTarget = String(target || '').trim();
        if (!activeCommentTarget) return;
        if (commentsTitle) commentsTitle.textContent = activeCommentTarget.startsWith('note-')
          ? '<?= day_escape($uiLang['comments_on_day']) ?>'
          : '<?= day_escape($uiLang['comments_on_media']) ?>';
        if (commentsAuthor && !commentsAuthor.value) {
          try { commentsAuthor.value = localStorage.getItem(AUTHOR_KEY) || ''; } catch {}
        }
        renderComments([], '<?= day_escape($uiLang['comments_loading']) ?>');
        commentsModal.classList.add('is-open');
        commentsModal.setAttribute('aria-hidden', 'false');
        try {
          const res = await fetch('/api/comments?target=' + encodeURIComponent(activeCommentTarget), { cache: 'no-store' });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const payload = await res.json();
          renderComments(payload && payload.comments ? payload.comments : []);
        } catch (err) {
          renderComments([], '<?= day_escape($uiLang['comments_load_error']) ?>');
        }
      };

      const closeComments = () => {
        commentsModal.classList.remove('is-open');
        commentsModal.setAttribute('aria-hidden', 'true');
        activeCommentTarget = '';
      };

      document.querySelectorAll('[data-comment-target]').forEach((btn) => {
        btn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          openComments(btn.getAttribute('data-comment-target'));
        });
      });

      if (commentsBackdrop) commentsBackdrop.addEventListener('click', closeComments);
      if (commentsClose) commentsClose.addEventListener('click', closeComments);
      if (commentsForm) {
        commentsForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          if (!activeCommentTarget) return;
          const author = String((commentsAuthor && commentsAuthor.value) || '').trim();
          const text = String((commentsText && commentsText.value) || '').trim();
          if (!author || !text) return;
          try { localStorage.setItem(AUTHOR_KEY, author); } catch {}
          const submitBtn = commentsForm.querySelector('button[type="submit"]');
          if (submitBtn) submitBtn.disabled = true;
          try {
            const res = await fetch('/api/comments', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ target: activeCommentTarget, author, text })
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            if (commentsText) commentsText.value = '';
            await openComments(activeCommentTarget);
          } catch (err) {
            renderComments([], '<?= day_escape($uiLang['comments_save_error']) ?>');
          } finally {
            if (submitBtn) submitBtn.disabled = false;
          }
        });
      }
    })();
  </script>
</body>
</html>

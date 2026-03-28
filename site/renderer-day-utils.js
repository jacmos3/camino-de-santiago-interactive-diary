(() => {
  const DAY_ZERO_DATE = '2019-06-04';
  const PROLOGUE_DATES = ['2019-06-02', '2019-06-03'];
  const PROLOGUE_TRACK_DATE = '2019-06-03';
  const PROLOGUE_UI_KEY = 'prologue';

  const formatDate = (dateStr, lang = 'it') => {
    const [y, m, d] = String(dateStr || '').split('-').map(Number);
    const date = new Date(y, (m || 1) - 1, d || 1);
    const fmt = new Intl.DateTimeFormat(lang || 'it', {
      day: 'numeric',
      month: 'long'
    });
    return fmt.format(date);
  };

  const formatDateNoWeekday = (dateStr, lang = 'it') => formatDate(dateStr, lang);

  const formatTimelineChipDate = (dateStr) => {
    const value = String(dateStr || '').slice(0, 10);
    const parts = value.split('-');
    if (parts.length !== 3) return value;
    return `${parts[2]}/${parts[1]}`;
  };

  const isPrologueSourceDate = (value) => {
    const day = String(value || '').slice(0, 10);
    return PROLOGUE_DATES.includes(day);
  };

  const normalizeDayUiKey = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw === PROLOGUE_UI_KEY) return PROLOGUE_UI_KEY;
    const maybeDay = raw.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(maybeDay)) {
      return isPrologueSourceDate(maybeDay) ? PROLOGUE_UI_KEY : maybeDay;
    }
    return raw;
  };

  const buildDefaultPrologueNarrative = (lang = 'it') => {
    if (lang === 'en') {
      return [
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
      ].join('\n');
    }
    if (lang === 'es') {
      return [
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
      ].join('\n');
    }
    if (lang === 'fr') {
      return [
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
      ].join('\n');
    }
    return [
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
    ].join('\n');
  };

  const computeDayNumber = ({ dateStr, dataCache = null, dayNumberingMode = '', dayZeroDate = DAY_ZERO_DATE, isPrologueDay = null }) => {
    const dateKey = String(dateStr || '').slice(0, 10);
    if (!dateKey) return '';
    if (dayNumberingMode === 'explicit-or-chronological' || dayNumberingMode === 'chronological') {
      if (dataCache && Array.isArray(dataCache.days)) {
        const ordered = Array.from(new Set(
          dataCache.days
            .filter((day) => (typeof isPrologueDay === 'function' ? !isPrologueDay(day) : true))
            .map((day) => String(day && day.date ? day.date : '').slice(0, 10))
            .filter(Boolean)
        )).sort();
        const index = ordered.indexOf(dateKey);
        if (index >= 0) return String(index + 1);
      }
      return '';
    }
    if (dateKey === '2019-06-02') return '00';
    if (dateKey === '2019-06-03') return '0';
    const start = Date.parse(`${dayZeroDate}T00:00:00`);
    const current = Date.parse(`${dateKey}T00:00:00`);
    if (Number.isNaN(start) || Number.isNaN(current)) return '';
    const deltaDays = Math.round((current - start) / (24 * 60 * 60 * 1000));
    if (deltaDays >= 0) return String(deltaDays + 1);
    return '';
  };

  window.CamminoRendererDayUtils = {
    DAY_ZERO_DATE,
    PROLOGUE_DATES,
    PROLOGUE_TRACK_DATE,
    PROLOGUE_UI_KEY,
    formatDate,
    formatDateNoWeekday,
    formatTimelineChipDate,
    isPrologueSourceDate,
    normalizeDayUiKey,
    buildDefaultPrologueNarrative,
    computeDayNumber
  };
})();

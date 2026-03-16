(function () {
  const data = window.DAY_PAGE_MAP_DATA && typeof window.DAY_PAGE_MAP_DATA === 'object'
    ? window.DAY_PAGE_MAP_DATA
    : null;
  if (!data || typeof window.L === 'undefined') return;

  const PHOTO_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp']);
  const OVERVIEW_START_OUTLIER_M = 120000;
  const MAP_MAX_ZOOM = 18;
  const trackPayloadCache = new Map();

  const toRad = (deg) => (Number(deg) * Math.PI) / 180;
  const escapeHtml = (value) => String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

  const distanceMeters = (a, b) => {
    if (!a || !b) return Number.POSITIVE_INFINITY;
    const lat1 = Number(a.lat);
    const lon1 = Number(a.lon);
    const lat2 = Number(b.lat);
    const lon2 = Number(b.lon);
    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const rLat1 = toRad(lat1);
    const rLat2 = toRad(lat2);
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(h));
  };

  const setEmptyState = (element, text) => {
    if (!element) return;
    element.classList.add('is-empty');
    element.textContent = text || '';
  };

  const clearState = (element) => {
    if (!element) return;
    element.classList.remove('is-empty');
    element.textContent = '';
  };

  const nudgeMapZoomIn = (map, levels = 1) => {
    if (!map || typeof map.getZoom !== 'function' || typeof map.setZoom !== 'function') return;
    const currentZoom = Number(map.getZoom());
    if (!Number.isFinite(currentZoom)) return;
    map.setZoom(Math.min(MAP_MAX_ZOOM, currentZoom + levels), { animate: false });
  };

  const simplifyTrackPoints = (points, minDistM) => {
    if (!Array.isArray(points) || points.length <= 2) return points || [];
    const out = [points[0]];
    let last = points[0];
    for (let i = 1; i < points.length - 1; i += 1) {
      const point = points[i];
      if (distanceMeters(last, point) >= minDistM) {
        out.push(point);
        last = point;
      }
    }
    out.push(points[points.length - 1]);
    return out;
  };

  const toTrackPoint = (point) => {
    const lat = Number(point && point.lat);
    const lon = Number(point && point.lon);
    const ts = Date.parse(String(point && point.time ? point.time : ''));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Number.isNaN(ts)) return null;
    const file = String(point && point.file ? point.file : '').trim();
    const lower = file.toLowerCase();
    if (lower.includes('.')) {
      const ext = lower.split('.').pop();
      if (!PHOTO_EXTENSIONS.has(ext)) return null;
    }
    return { lat, lon, ts, file };
  };

  const buildTrackSegments = (points) => {
    const raw = (Array.isArray(points) ? points : [])
      .map(toTrackPoint)
      .filter(Boolean);
    if (!raw.length) return [];
    const hasRuntastic = raw.some((point) => String(point.file || '').startsWith('RUNTASTIC_'));
    const source = hasRuntastic
      ? raw.filter((point) => String(point.file || '').startsWith('RUNTASTIC_'))
      : raw;
    source.sort((a, b) => a.ts - b.ts);

    const groups = new Map();
    source.forEach((point) => {
      const key = point.file || '__single__';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(point);
    });

    const segments = [];
    groups.forEach((group) => {
      group.sort((a, b) => a.ts - b.ts);
      const simplified = simplifyTrackPoints(group, 10);
      if (simplified.length >= 2) segments.push(simplified);
    });
    return segments;
  };

  const fetchTrackPayload = async (dayKey) => {
    const key = String(dayKey || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
    if (trackPayloadCache.has(key)) return trackPayloadCache.get(key);
    const promise = fetch(`/data/tracks/day/${encodeURIComponent(key)}.json`, { cache: 'force-cache' })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
    trackPayloadCache.set(key, promise);
    return promise;
  };

  const buildMediaGroups = (items) => {
    const groups = new Map();
    (Array.isArray(items) ? items : []).forEach((item) => {
      const id = String(item && item.id ? item.id : '').trim();
      const lat = Number(item && item.lat);
      const lon = Number(item && item.lon);
      if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const key = `${lat.toFixed(3)}|${lon.toFixed(3)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({
        id,
        lat,
        lon,
        type: String(item && item.type ? item.type : '').trim(),
        time: String(item && item.time ? item.time : '').trim(),
        place: String(item && item.place ? item.place : '').trim()
      });
    });

    return Array.from(groups.entries()).map(([key, itemsInGroup]) => {
      const [latStr, lonStr] = key.split('|');
      return {
        lat: Number(latStr),
        lon: Number(lonStr),
        items: itemsInGroup.slice().sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')))
      };
    });
  };

  const buildMediaGroupTitle = (group) => {
    const items = Array.isArray(group && group.items) ? group.items : [];
    const first = items[0] || {};
    const count = items.length;
    const place = String(first.place || '').trim();
    const placeSuffix = place ? ` · ${place}` : '';
    if (count > 1) return `${count} media${placeSuffix}`;
    if (String(first.type || '') === 'video') return `${String(first.time || '').trim()}${placeSuffix} · video`;
    return `${String(first.time || '').trim()}${placeSuffix}`.trim();
  };

  const openMediaGroup = (group) => {
    const ids = (Array.isArray(group && group.items) ? group.items : [])
      .map((item) => String(item && item.id ? item.id : '').trim())
      .filter(Boolean);
    if (!ids.length) return;
    if (window.dayPageMediaApi && typeof window.dayPageMediaApi.openGroup === 'function') {
      window.dayPageMediaApi.openGroup(ids);
      return;
    }
    const first = document.querySelector(`.day-media-link[data-media-id="${CSS.escape(ids[0])}"]`);
    if (first) first.click();
  };

  const buildOverviewRoutePoints = (stages) => {
    const points = [];
    const pushIfFar = (point) => {
      const lat = Number(point && point.lat);
      const lon = Number(point && point.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const next = { lat, lon };
      const last = points[points.length - 1];
      if (last && distanceMeters(last, next) < 30) return;
      points.push(next);
    };

    (Array.isArray(stages) ? stages : []).forEach((stage) => {
      const start = stage && stage.start;
      const end = stage && stage.end;
      const skipStart = Boolean(start && end && distanceMeters(start, end) > OVERVIEW_START_OUTLIER_M);
      if (!skipStart) pushIfFar(start);
      pushIfFar(end);
    });
    return points;
  };

  const renderDetailMap = async (card, dayKey, loadingText, emptyText) => {
    const bodyEl = card.querySelector('[data-day-track-body]');
    if (!bodyEl) return;
    setEmptyState(bodyEl, loadingText);

    const payload = await fetchTrackPayload(dayKey);
    const segments = buildTrackSegments(payload && payload.points);
    const totalPoints = segments.reduce((acc, segment) => acc + segment.length, 0);
    if (!segments.length || totalPoints < 2) {
      setEmptyState(bodyEl, emptyText);
      return;
    }

    clearState(bodyEl);
    const mapEl = document.createElement('div');
    mapEl.className = 'day-track__map';
    const metaEl = document.createElement('div');
    metaEl.className = 'day-track__meta';
    metaEl.textContent = `${totalPoints} pts`;
    bodyEl.appendChild(mapEl);
    bodyEl.appendChild(metaEl);

    const map = window.L.map(mapEl, {
      zoomControl: true,
      attributionControl: false,
      dragging: true,
      scrollWheelZoom: false,
      doubleClickZoom: true,
      boxZoom: false,
      keyboard: false,
      touchZoom: true,
    });

    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
    }).addTo(map);

    let bounds = null;
    segments.forEach((segment) => {
      const latlngs = segment.map((point) => [point.lat, point.lon]);
      const line = window.L.polyline(latlngs, {
        color: '#b06c36',
        weight: 4,
        opacity: 0.9
      }).addTo(map);
      bounds = bounds ? bounds.extend(line.getBounds()) : line.getBounds();
    });

    const first = segments[0] && segments[0][0];
    const lastSegment = segments[segments.length - 1] || null;
    const last = lastSegment && lastSegment[lastSegment.length - 1];
    if (first) {
      window.L.circleMarker([first.lat, first.lon], {
        radius: 5,
        color: '#1f5f5b',
        weight: 2,
        fillColor: '#1f5f5b',
        fillOpacity: 0.95
      }).addTo(map);
    }
    if (last) {
      window.L.circleMarker([last.lat, last.lon], {
        radius: 5,
        color: '#d08643',
        weight: 2,
        fillColor: '#d08643',
        fillOpacity: 0.95
      }).addTo(map);
    }

    buildMediaGroups(data.mediaItems).forEach((group) => {
      const marker = window.L.circleMarker([group.lat, group.lon], {
        radius: group.items.length > 1 ? 6 : 4.5,
        color: '#153d70',
        weight: 2,
        fillColor: '#4b83c7',
        fillOpacity: 0.95
      }).addTo(map);
      const title = buildMediaGroupTitle(group);
      if (title) marker.bindTooltip(title, { direction: 'top', opacity: 0.94 });
      marker.on('click', () => openMediaGroup(group));
      bounds = bounds ? bounds.extend(marker.getLatLng()) : window.L.latLngBounds([marker.getLatLng()]);
    });

    if (bounds && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [18, 18], animate: false });
      nudgeMapZoomIn(map, 1);
    }
    window.setTimeout(() => map.invalidateSize(), 0);
  };

  const renderOverviewMap = (card, dayKey, emptyText) => {
    const overviewEl = card.querySelector('[data-day-track-overview]');
    if (!overviewEl) return;

    const stages = Array.isArray(data.stages) ? data.stages : [];
    if (!stages.length) {
      setEmptyState(overviewEl, emptyText);
      return;
    }

    clearState(overviewEl);
    const overviewMapEl = document.createElement('div');
    overviewMapEl.className = 'day-track__overview-map';
    overviewEl.appendChild(overviewMapEl);

    const map = window.L.map(overviewMapEl, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
    });

    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
    }).addTo(map);

    const layer = window.L.layerGroup().addTo(map);
    const routePoints = buildOverviewRoutePoints(stages);
    let bounds = null;
    if (routePoints.length >= 2) {
      const latlngs = routePoints.map((point) => [point.lat, point.lon]);
      const route = window.L.polyline(latlngs, {
        color: '#c6a78a',
        weight: 2,
        opacity: 0.8,
        dashArray: '4 6'
      }).addTo(layer);
      bounds = route.getBounds();
    }

    const currentIndex = stages.findIndex((stage) => String(stage && stage.dayKey ? stage.dayKey : '') === dayKey);
    const firstMarkerStageIndex = stages.findIndex((stage) => {
      const start = stage && stage.start;
      const end = stage && stage.end;
      const hasStart = start && Number.isFinite(Number(start.lat)) && Number.isFinite(Number(start.lon));
      const hasEnd = end && Number.isFinite(Number(end.lat)) && Number.isFinite(Number(end.lon));
      return hasStart || hasEnd;
    });
    const focusIndexes = new Set(
      [currentIndex - 1, currentIndex, currentIndex + 1].filter((idx) => idx >= 0 && idx < stages.length)
    );

    stages.forEach((stage, index) => {
      const isCurrent = index === currentIndex;
      const isFocus = focusIndexes.has(index);
      const hideStagePins = index === firstMarkerStageIndex;
      const start = stage && stage.start;
      const end = stage && stage.end;
      const skipStart = Boolean(start && end && distanceMeters(start, end) > OVERVIEW_START_OUTLIER_M);
      if (!hideStagePins && !skipStart && start && Number.isFinite(Number(start.lat)) && Number.isFinite(Number(start.lon))) {
        const startMarker = window.L.circleMarker([Number(start.lat), Number(start.lon)], {
          radius: isCurrent ? 4.2 : 3,
          color: isCurrent ? '#1f5f5b' : '#8b7663',
          weight: isCurrent ? 2 : 1.2,
          fillColor: '#fffaf2',
          fillOpacity: 0.96
        }).addTo(layer);
        bounds = bounds ? bounds.extend(startMarker.getLatLng()) : window.L.latLngBounds([startMarker.getLatLng()]);
      }
      if (end && Number.isFinite(Number(end.lat)) && Number.isFinite(Number(end.lon))) {
        const endLatLng = [Number(end.lat), Number(end.lon)];
        if (!hideStagePins) {
          const endMarker = window.L.circleMarker(endLatLng, {
            radius: isCurrent ? 5.2 : (isFocus ? 4.6 : 4),
            color: isCurrent ? '#b06c36' : '#8b7663',
            weight: isCurrent ? 2 : 1.2,
            fillColor: isCurrent ? '#d08643' : '#d9ccbc',
            fillOpacity: 0.96
          }).addTo(layer);
          if (stage && stage.label) {
            endMarker.bindTooltip(String(stage.label), { direction: 'top', opacity: 0.94 });
          }
          if (stage && stage.href) {
            endMarker.on('click', () => {
              window.location.href = String(stage.href);
            });
          }
          bounds = bounds ? bounds.extend(endMarker.getLatLng()) : window.L.latLngBounds([endMarker.getLatLng()]);
        }
        if (isFocus && stage && stage.label && stage.href) {
          const className = isCurrent
            ? 'map-stage-label__pill map-stage-label__pill--current'
            : 'map-stage-label__pill';
          window.L.marker(endLatLng, {
            interactive: true,
            zIndexOffset: isCurrent ? 1200 : 900,
            icon: window.L.divIcon({
              className: 'map-stage-label',
              html: `<a class="${className}" href="${escapeHtml(String(stage.href))}">${escapeHtml(String(stage.label))}</a>`,
              iconSize: null
            })
          }).addTo(layer);
        }
      }
    });

    if (bounds && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [4, 4], animate: false });
      nudgeMapZoomIn(map, 1);
    }
    window.setTimeout(() => map.invalidateSize(), 0);
  };

  const cards = Array.from(document.querySelectorAll('[data-day-track-key]'));
  cards.forEach((card) => {
    const dayKey = String(card.getAttribute('data-day-track-key') || '').trim().slice(0, 10);
    const loadingText = String(card.getAttribute('data-day-track-loading') || '').trim();
    const emptyText = String(card.getAttribute('data-day-track-empty') || '').trim();
    if (!dayKey) return;
    renderOverviewMap(card, dayKey, emptyText);
    renderDetailMap(card, dayKey, loadingText, emptyText).catch(() => {
      setEmptyState(card.querySelector('[data-day-track-body]'), emptyText);
    });
  });
})();

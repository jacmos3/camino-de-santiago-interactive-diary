const map = L.map('map', { scrollWheelZoom: true });
const PHOTO_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp']);
const MAX_LINK_KM = 100;
const selectedDay = new URLSearchParams(window.location.search).get('day') || '';
const selectedUptoDay = new URLSearchParams(window.location.search).get('upto') || '';
const MEDIA_DETAIL_MIN = 0;
const MEDIA_DETAIL_MAX = 6;
const MEDIA_DETAIL_DEFAULT = 0;

const isPhotoFile = (name) => {
  const file = (name ? String(name) : '').trim().toLowerCase();
  if (!file.includes('.')) return true;
  const ext = file.split('.').pop();
  return PHOTO_EXTENSIONS.has(ext);
};

const parsePointTs = (point) => {
  const ts = Date.parse(String(point && point.time ? point.time : ''));
  return Number.isNaN(ts) ? Number.NEGATIVE_INFINITY : ts;
};

const toFiniteCoord = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const formatPointDateTime = (raw) => {
  if (!raw) return '';
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('it-IT', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const assetUrl = (value) => (value ? String(value) : '');

const flattenDayItems = (items) => {
  const out = [];
  const walk = (arr) => {
    (arr || []).forEach((item) => {
      if (!item) return;
      if (item.type === 'group' && Array.isArray(item.items)) {
        walk(item.items);
        return;
      }
      out.push(item);
    });
  };
  walk(items);
  return out;
};

const parseMediaTs = (entry) => {
  const date = String(entry && entry.date ? entry.date : '').slice(0, 10);
  const time = String(entry && entry.time ? entry.time : '').slice(0, 5);
  const iso = date && time ? `${date}T${time}:00` : '';
  const ts = Date.parse(iso);
  return Number.isNaN(ts) ? Number.NEGATIVE_INFINITY : ts;
};

const buildMediaPoints = (entriesData) => {
  const days = Array.isArray(entriesData && entriesData.days) ? entriesData.days : [];
  const points = [];
  days.forEach((day) => {
    flattenDayItems(day.items || []).forEach((item) => {
      if (!item || (item.type !== 'image' && item.type !== 'video')) return;
      const lat = toFiniteCoord(item.lat);
      const lon = toFiniteCoord(item.lon);
      if (lat === null || lon === null) return;
      points.push({
        id: item.id || '',
        type: item.type,
        date: String(item.date || '').slice(0, 10),
        time: item.time || '',
        place: item.place || '',
        src: item.src || '',
        thumb: item.thumb || '',
        poster: item.poster || '',
        orig: item.orig || '',
        mime: item.mime || '',
        lat,
        lon,
        ts: parseMediaTs(item)
      });
    });
  });
  return points.sort((a, b) => a.ts - b.ts);
};

const groupMediaPointsByPrecision = (points, precision) => {
  const groups = new Map();
  (points || []).forEach((p) => {
    const key = `${p.lat.toFixed(precision)}|${p.lon.toFixed(precision)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  });
  const out = [];
  groups.forEach((items) => {
    const center = items.reduce((acc, p) => {
      acc.lat += p.lat;
      acc.lon += p.lon;
      return acc;
    }, { lat: 0, lon: 0 });
    out.push({
      lat: center.lat / items.length,
      lon: center.lon / items.length,
      items: items.slice().sort((a, b) => a.ts - b.ts)
    });
  });
  return out;
};

const formatMediaPopupDateTime = (item) => {
  const date = String(item && item.date ? item.date : '').slice(0, 10);
  const time = String(item && item.time ? item.time : '').slice(0, 5);
  if (!date && !time) return '';
  if (!date) return time;
  if (!time) return date;
  return `${date} ${time}`;
};

const normalizeTrackPointsByActivityDay = (points) => {
  const list = Array.isArray(points) ? points : [];
  const groups = new Map();
  list.forEach((point) => {
    const file = String(point && point.file ? point.file : '');
    if (!file) return;
    if (!groups.has(file)) groups.set(file, []);
    groups.get(file).push(point);
  });

  const out = [];
  groups.forEach((entries, file) => {
    const isRuntastic = file.startsWith('RUNTASTIC_');
    if (!isRuntastic) {
      entries.forEach((point) => out.push({
        ...point,
        mapDate: String(point && point.date ? point.date : '').slice(0, 10)
      }));
      return;
    }

    const sorted = [...entries].sort((a, b) => parsePointTs(a) - parsePointTs(b));
    const dayCounts = new Map();
    sorted.forEach((point) => {
      const day = String(point && point.date ? point.date : '').slice(0, 10);
      if (!day) return;
      dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
    });
    let anchorDate = String((sorted[0] && sorted[0].date) || '').slice(0, 10);
    let bestCount = -1;
    dayCounts.forEach((count, day) => {
      if (count > bestCount) {
        bestCount = count;
        anchorDate = day;
      }
    });
    sorted.forEach((point) => out.push({
      ...point,
      mapDate: anchorDate
    }));
  });
  return out;
};

const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
});

tiles.addTo(map);

const toRad = (deg) => (Number(deg) * Math.PI) / 180;
const distanceKm = (a, b) => {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const lat1 = Number(a[0]);
  const lon1 = Number(a[1]);
  const lat2 = Number(b[0]);
  const lon2 = Number(b[1]);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const rLat1 = toRad(lat1);
  const rLat2 = toRad(lat2);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

const midpoint = (a, b) => [
  (Number(a[0]) + Number(b[0])) / 2,
  (Number(a[1]) + Number(b[1])) / 2
];

const buildFlightCurve = (from, to, segments = 24) => {
  const lat1 = Number(from[0]);
  const lon1 = Number(from[1]);
  const lat2 = Number(to[0]);
  const lon2 = Number(to[1]);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return [from, to];

  const dx = lon2 - lon1;
  const dy = lat2 - lat1;
  const len = Math.hypot(dx, dy);
  if (!len) return [[lat1, lon1], [lat2, lon2]];

  // Perpendicular offset gives a lightweight arc without extra libs.
  const nx = -dy / len;
  const ny = dx / len;
  const bend = len * 0.22;
  const midLat = (lat1 + lat2) / 2;
  const midLon = (lon1 + lon2) / 2;
  const cLat = midLat - ny * bend;
  const cLon = midLon - nx * bend;

  const points = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const mt = 1 - t;
    const lat = mt * mt * lat1 + 2 * mt * t * cLat + t * t * lat2;
    const lon = mt * mt * lon1 + 2 * mt * t * cLon + t * t * lon2;
    points.push([lat, lon]);
  }
  return points;
};

const buildSegmentsFromFeatures = (features) => {
  const lineSegments = [];
  const flightSegments = [];
  let currentSegment = [];
  (features || []).forEach((feature, idx) => {
    const [lon, lat] = feature.geometry.coordinates || [];
    const curr = [lat, lon];
    if (!currentSegment.length) {
      currentSegment.push(curr);
      return;
    }
    const prevFeature = features[idx - 1];
    const [prevLon, prevLat] = prevFeature.geometry.coordinates || [];
    const prev = [prevLat, prevLon];
    const jumpKm = distanceKm(prev, curr);
    const split = jumpKm > MAX_LINK_KM;
    if (split) {
      if (Number.isFinite(jumpKm)) {
        flightSegments.push({ from: prev, to: curr, km: jumpKm });
      }
      if (currentSegment.length >= 2) lineSegments.push(currentSegment);
      currentSegment = [curr];
    } else {
      currentSegment.push(curr);
    }
  });
  if (currentSegment.length >= 2) lineSegments.push(currentSegment);
  return { lineSegments, flightSegments };
};

const buildMediaDetailControl = (onChange, initialPrecision) => {
  const control = L.control({ position: 'topright' });
  control.onAdd = () => {
    const wrap = L.DomUtil.create('div', 'map-media-detail-control');
    wrap.innerHTML = `
      <div class="map-media-detail-control__title">Dettaglio media</div>
      <input class="map-media-detail-control__range" type="range" min="${MEDIA_DETAIL_MIN}" max="${MEDIA_DETAIL_MAX}" step="1" value="${initialPrecision}">
      <div class="map-media-detail-control__value">${initialPrecision} decimali</div>
    `;
    const input = wrap.querySelector('.map-media-detail-control__range');
    const valueEl = wrap.querySelector('.map-media-detail-control__value');
    const apply = () => {
      const next = Number(input.value);
      valueEl.textContent = `${next} decimali`;
      onChange(next);
    };
    input.addEventListener('input', apply);
    L.DomEvent.disableClickPropagation(wrap);
    L.DomEvent.disableScrollPropagation(wrap);
    return wrap;
  };
  return control;
};

const mapMediaModal = {
  root: document.getElementById('map-media-modal'),
  backdrop: document.getElementById('map-media-modal-backdrop'),
  close: document.getElementById('map-media-modal-close'),
  body: document.getElementById('map-media-modal-body'),
  meta: document.getElementById('map-media-modal-meta')
};

let mapModalItems = [];
let mapModalIndex = -1;
let mapModalZoomCleanup = null;
let mapModalGroupScrollTop = 0;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const attachMapImageZoom = (image, controls = null) => {
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let startTx = 0;
  let startTy = 0;
  const ZOOM_STEP = 1.2;

  const applyTransform = () => {
    image.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    image.classList.toggle('is-zoomed', scale > 1.001);
    if (controls) {
      controls.zoomOut.disabled = scale <= 1.001;
      controls.zoomIn.disabled = scale >= 4.999;
    }
  };

  const zoomTo = (nextScale) => {
    scale = clamp(nextScale, 1, 5);
    if (scale <= 1.001) {
      tx = 0;
      ty = 0;
    }
    applyTransform();
  };

  const onWheel = (event) => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0015);
    zoomTo(scale * factor);
  };
  const onZoomIn = () => zoomTo(scale * ZOOM_STEP);
  const onZoomOut = () => zoomTo(scale / ZOOM_STEP);
  const onDoubleClick = (event) => {
    event.preventDefault();
    zoomTo(scale > 1.1 ? 1 : 2);
  };
  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    if (scale <= 1.001) return;
    isDragging = true;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    startTx = tx;
    startTy = ty;
    image.setPointerCapture(event.pointerId);
    image.classList.add('is-dragging');
  };
  const onPointerMove = (event) => {
    if (!isDragging) return;
    event.preventDefault();
    tx = startTx + (event.clientX - dragStartX);
    ty = startTy + (event.clientY - dragStartY);
    applyTransform();
  };
  const onPointerUp = (event) => {
    if (!isDragging) return;
    isDragging = false;
    image.classList.remove('is-dragging');
    try {
      image.releasePointerCapture(event.pointerId);
    } catch {
      // no-op
    }
  };

  image.addEventListener('wheel', onWheel, { passive: false });
  image.addEventListener('dblclick', onDoubleClick);
  image.addEventListener('pointerdown', onPointerDown);
  image.addEventListener('pointermove', onPointerMove);
  image.addEventListener('pointerup', onPointerUp);
  image.addEventListener('pointercancel', onPointerUp);
  if (controls) {
    controls.zoomIn.addEventListener('click', onZoomIn);
    controls.zoomOut.addEventListener('click', onZoomOut);
  }
  applyTransform();

  return () => {
    image.removeEventListener('wheel', onWheel);
    image.removeEventListener('dblclick', onDoubleClick);
    image.removeEventListener('pointerdown', onPointerDown);
    image.removeEventListener('pointermove', onPointerMove);
    image.removeEventListener('pointerup', onPointerUp);
    image.removeEventListener('pointercancel', onPointerUp);
    if (controls) {
      controls.zoomIn.removeEventListener('click', onZoomIn);
      controls.zoomOut.removeEventListener('click', onZoomOut);
    }
  };
};

const closeMapMediaModal = () => {
  if (!mapMediaModal.root) return;
  if (mapModalZoomCleanup) {
    mapModalZoomCleanup();
    mapModalZoomCleanup = null;
  }
  mapMediaModal.root.classList.remove('open');
  mapMediaModal.root.setAttribute('aria-hidden', 'true');
  mapMediaModal.body.innerHTML = '';
  mapMediaModal.body.classList.remove('modal__body--with-group');
  mapModalItems = [];
  mapModalIndex = -1;
  mapModalGroupScrollTop = 0;
};

const renderMapMediaModal = () => {
  if (!mapMediaModal.root || mapModalIndex < 0 || !mapModalItems.length) return;
  if (mapModalZoomCleanup) {
    mapModalZoomCleanup();
    mapModalZoomCleanup = null;
  }
  const item = mapModalItems[mapModalIndex];
  if (!item) return;
  mapMediaModal.body.innerHTML = '';
  mapMediaModal.body.classList.toggle('modal__body--with-group', mapModalItems.length > 1);
  if (mapMediaModal.meta) {
    const day = String(item.date || '').slice(0, 10);
    const label = `${formatMediaPopupDateTime(item)}${item.place ? ` · ${item.place}` : ''}`;
    mapMediaModal.meta.textContent = day ? `${label} - vai al giorno` : label;
    mapMediaModal.meta.href = day ? `index.html#note-${encodeURIComponent(day)}` : '#';
    mapMediaModal.meta.onclick = (event) => {
      if (!day) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      const ok = window.confirm(`Vuoi aprire il diario del ${day} per leggere i dettagli?`);
      if (!ok) return;
      window.location.href = mapMediaModal.meta.href;
    };
  }

  if (item.type === 'video') {
    const video = document.createElement('video');
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = 'metadata';
    if (item.poster) video.poster = assetUrl(item.poster);
    const source = document.createElement('source');
    source.src = assetUrl(item.src);
    source.type = item.mime || 'video/mp4';
    video.appendChild(source);
    mapMediaModal.body.appendChild(video);
  } else {
    const zoomControls = document.createElement('div');
    zoomControls.className = 'modal__zoom-controls';
    const zoomOutBtn = document.createElement('button');
    zoomOutBtn.type = 'button';
    zoomOutBtn.className = 'modal__zoom-btn';
    zoomOutBtn.textContent = '−';
    const zoomInBtn = document.createElement('button');
    zoomInBtn.type = 'button';
    zoomInBtn.className = 'modal__zoom-btn';
    zoomInBtn.textContent = '+';
    zoomControls.appendChild(zoomOutBtn);
    zoomControls.appendChild(zoomInBtn);
    mapMediaModal.body.appendChild(zoomControls);

    const shell = document.createElement('div');
    shell.className = 'modal__zoom-shell';
    const img = document.createElement('img');
    img.className = 'modal__image';
    img.src = assetUrl(item.src || item.thumb);
    img.alt = item.orig || '';
    shell.appendChild(img);
    mapMediaModal.body.appendChild(shell);
    mapModalZoomCleanup = attachMapImageZoom(img, { zoomIn: zoomInBtn, zoomOut: zoomOutBtn });
  }

  if (mapModalItems.length > 1) {
    const nav = document.createElement('div');
    nav.className = 'modal__nav';
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'modal__nav-btn modal__nav-btn--prev';
    prevBtn.setAttribute('aria-label', 'Elemento precedente');
    prevBtn.textContent = '‹';
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'modal__nav-btn modal__nav-btn--next';
    nextBtn.setAttribute('aria-label', 'Elemento successivo');
    nextBtn.textContent = '›';
    prevBtn.addEventListener('click', () => {
      mapModalIndex = (mapModalIndex - 1 + mapModalItems.length) % mapModalItems.length;
      renderMapMediaModal();
    });
    nextBtn.addEventListener('click', () => {
      mapModalIndex = (mapModalIndex + 1) % mapModalItems.length;
      renderMapMediaModal();
    });
    nav.appendChild(prevBtn);
    nav.appendChild(nextBtn);
    mapMediaModal.body.appendChild(nav);

    const panel = document.createElement('div');
    panel.className = 'modal__group-panel';
    const title = document.createElement('div');
    title.className = 'modal__group-title';
    title.textContent = 'Carosello';
    panel.appendChild(title);

    const list = document.createElement('div');
    list.className = 'modal__group-list';
    list.setAttribute('role', 'listbox');
    list.scrollTop = mapModalGroupScrollTop;
    list.addEventListener('scroll', () => {
      mapModalGroupScrollTop = list.scrollTop;
    });

    mapModalItems.forEach((entry, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'modal__group-item';
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-label', entry.orig || 'Elemento');
      if (idx === mapModalIndex) {
        btn.classList.add('is-active');
        btn.setAttribute('aria-selected', 'true');
      } else {
        btn.setAttribute('aria-selected', 'false');
      }
      const preview = document.createElement('img');
      preview.className = 'modal__group-thumb';
      preview.src = assetUrl(entry.poster || entry.thumb || entry.src);
      preview.alt = entry.orig || '';
      btn.appendChild(preview);
      btn.addEventListener('click', () => {
        mapModalIndex = idx;
        renderMapMediaModal();
      });
      list.appendChild(btn);
    });
    panel.appendChild(list);
    mapMediaModal.body.appendChild(panel);
    window.requestAnimationFrame(() => {
      list.scrollTop = mapModalGroupScrollTop;
    });
  }
};

const openMapMediaModal = (items, startIndex = 0) => {
  if (!mapMediaModal.root) return;
  mapModalItems = Array.isArray(items) ? items : [];
  if (!mapModalItems.length) return;
  mapModalIndex = Math.max(0, Math.min(startIndex, mapModalItems.length - 1));
  renderMapMediaModal();
  mapMediaModal.root.classList.add('open');
  mapMediaModal.root.setAttribute('aria-hidden', 'false');
};

if (mapMediaModal.close) mapMediaModal.close.addEventListener('click', closeMapMediaModal);
if (mapMediaModal.backdrop) mapMediaModal.backdrop.addEventListener('click', closeMapMediaModal);
window.addEventListener('keydown', (event) => {
  if (!mapMediaModal.root || !mapMediaModal.root.classList.contains('open')) return;
  if (event.key === 'Escape') {
    closeMapMediaModal();
    return;
  }
  if (!mapModalItems.length) return;
  if (event.key === 'ArrowLeft') {
    mapModalIndex = (mapModalIndex - 1 + mapModalItems.length) % mapModalItems.length;
    renderMapMediaModal();
  } else if (event.key === 'ArrowRight') {
    mapModalIndex = (mapModalIndex + 1) % mapModalItems.length;
    renderMapMediaModal();
  }
});

Promise.all([
  fetch('data/track_points.json').then((res) => res.json()).catch(() => []),
  fetch('data/entries.it.json').then((res) => res.json()).catch(() => ({ days: [] }))
])
  .then(([trackPoints, entriesData]) => {
    const normalizedTrackPoints = normalizeTrackPointsByActivityDay(trackPoints);
    const mediaPoints = buildMediaPoints(entriesData);
    const pointFeatures = normalizedTrackPoints
      .filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)))
      .filter((p) => isPhotoFile(p.file))
      .sort((a, b) => {
        const ta = Date.parse(String(a.time || ''));
        const tb = Date.parse(String(b.time || ''));
        if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
        if (Number.isNaN(ta)) return 1;
        if (Number.isNaN(tb)) return -1;
        return ta - tb;
      })
      .map((p) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [Number(p.lon), Number(p.lat)]
        },
        properties: {
          time: p.time || '',
          file: p.file || '',
          date: p.mapDate || p.date || ''
        }
      }));
    const { lineSegments, flightSegments } = buildSegmentsFromFeatures(pointFeatures);
    const selectedFeatures = selectedDay
      ? pointFeatures.filter((f) => String(f.properties && f.properties.date ? f.properties.date : '') === selectedDay)
      : [];
    const selectedUptoFeatures = selectedUptoDay
      ? pointFeatures.filter((f) => String(f.properties && f.properties.date ? f.properties.date : '') <= selectedUptoDay)
      : [];
    const selectedSplit = buildSegmentsFromFeatures(selectedFeatures);
    const selectedUptoSplit = buildSegmentsFromFeatures(selectedUptoFeatures);

    let lineLayer = null;
    lineSegments.forEach((segment) => {
      const poly = L.polyline(segment, {
        color: '#b06c36',
        weight: 4,
        opacity: 0.9
      }).addTo(map);
      if (!lineLayer) lineLayer = poly;
    });

    flightSegments.forEach((segment) => {
      const curved = buildFlightCurve(segment.from, segment.to);
      L.polyline(curved, {
        color: '#5f7fa7',
        weight: 3,
        opacity: 0.9,
        dashArray: '8 8'
      }).addTo(map);

      const mid = curved[Math.floor(curved.length / 2)] || midpoint(segment.from, segment.to);
      const plane = L.marker(mid, {
        icon: L.divIcon({
          className: 'map-flight-icon',
          html: '<span class="map-flight-glyph">✈</span>',
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        })
      }).addTo(map);
      plane.bindPopup(`Tratto aereo ~${Math.round(segment.km)} km`);
    });

    let selectedLineLayer = null;
    selectedSplit.lineSegments.forEach((segment) => {
      const poly = L.polyline(segment, {
        color: '#da6c2c',
        weight: 6,
        opacity: 0.95
      }).addTo(map);
      if (!selectedLineLayer) selectedLineLayer = poly;
    });
    selectedSplit.flightSegments.forEach((segment) => {
      const curved = buildFlightCurve(segment.from, segment.to);
      L.polyline(curved, {
        color: '#da6c2c',
        weight: 4,
        opacity: 0.95,
        dashArray: '10 8'
      }).addTo(map);
      const mid = curved[Math.floor(curved.length / 2)] || midpoint(segment.from, segment.to);
      L.marker(mid, {
        icon: L.divIcon({
          className: 'map-flight-icon map-flight-icon--day',
          html: '<span class="map-flight-glyph">✈</span>',
          iconSize: [34, 34],
          iconAnchor: [17, 17]
        })
      }).addTo(map);
    });

    let selectedUptoLineLayer = null;
    selectedUptoSplit.lineSegments.forEach((segment) => {
      const poly = L.polyline(segment, {
        color: '#2b6cb0',
        weight: 5,
        opacity: 0.9
      }).addTo(map);
      if (!selectedUptoLineLayer) selectedUptoLineLayer = poly;
    });
    selectedUptoSplit.flightSegments.forEach((segment) => {
      const curved = buildFlightCurve(segment.from, segment.to);
      L.polyline(curved, {
        color: '#2b6cb0',
        weight: 3.5,
        opacity: 0.9,
        dashArray: '8 7'
      }).addTo(map);
      const mid = curved[Math.floor(curved.length / 2)] || midpoint(segment.from, segment.to);
      L.marker(mid, {
        icon: L.divIcon({
          className: 'map-flight-icon map-flight-icon--upto',
          html: '<span class="map-flight-glyph">✈</span>',
          iconSize: [32, 32],
          iconAnchor: [16, 16]
        })
      }).addTo(map);
    });

    let mediaPinsLayer = L.featureGroup().addTo(map);
    const renderMediaPins = (precision) => {
      mediaPinsLayer.clearLayers();
      const groups = groupMediaPointsByPrecision(mediaPoints, precision);
      groups.forEach((group) => {
        const count = group.items.length;
        const imageCount = group.items.filter((it) => it.type === 'image').length;
        const videoCount = group.items.filter((it) => it.type === 'video').length;
        const first = group.items[0] || {};
        const place = String(first.place || '').trim();
        let popup = '';
        if (count > 1) {
          popup = `${count} media (${imageCount} foto, ${videoCount} video)`;
          if (place) popup += `<br>${place}`;
        } else {
          const when = formatMediaPopupDateTime(first);
          const typeLabel = first.type === 'video' ? 'video' : 'foto';
          popup = `${when ? `${when} · ` : ''}${typeLabel}`;
          if (place) popup += `<br>${place}`;
        }
        const marker = L.circleMarker([group.lat, group.lon], {
          radius: count > 1 ? 6.5 : 4.5,
          color: '#1d4f86',
          weight: 2,
          fillColor: '#78aee6',
          fillOpacity: 0.9
        });
        if (popup) marker.bindPopup(popup);
        marker.on('click', () => openMapMediaModal(group.items, 0));
        marker.addTo(mediaPinsLayer);
      });
    };

    renderMediaPins(MEDIA_DETAIL_DEFAULT);
    buildMediaDetailControl(renderMediaPins, MEDIA_DETAIL_DEFAULT).addTo(map);

    const selectedPointsLayer = L.geoJSON({ type: 'FeatureCollection', features: selectedFeatures }, {
      pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
        radius: 6,
        color: '#8d3f15',
        weight: 2,
        fillColor: '#f0a56f',
        fillOpacity: 0.95
      })
    }).addTo(map);

    const selectedUptoPointsLayer = L.geoJSON({ type: 'FeatureCollection', features: selectedUptoFeatures }, {
      pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
        radius: 5,
        color: '#1d4f86',
        weight: 2,
        fillColor: '#78aee6',
        fillOpacity: 0.9
      })
    }).addTo(map);

    const boundsCandidates = [];
    if (lineLayer && lineLayer.getBounds().isValid()) boundsCandidates.push(lineLayer.getBounds());
    if (mediaPinsLayer && mediaPinsLayer.getBounds && mediaPinsLayer.getBounds().isValid()) boundsCandidates.push(mediaPinsLayer.getBounds());
    if (selectedUptoLineLayer && selectedUptoLineLayer.getBounds().isValid()) boundsCandidates.unshift(selectedUptoLineLayer.getBounds());
    if (selectedUptoPointsLayer && selectedUptoPointsLayer.getBounds().isValid()) boundsCandidates.unshift(selectedUptoPointsLayer.getBounds());
    if (selectedLineLayer && selectedLineLayer.getBounds().isValid()) boundsCandidates.unshift(selectedLineLayer.getBounds());
    if (selectedPointsLayer && selectedPointsLayer.getBounds().isValid()) boundsCandidates.unshift(selectedPointsLayer.getBounds());
    if (boundsCandidates.length) {
      const bounds = boundsCandidates[0];
      for (let i = 1; i < boundsCandidates.length; i += 1) bounds.extend(boundsCandidates[i]);
      map.fitBounds(bounds, { padding: [20, 20] });
    } else {
      map.setView([0, 0], 2);
    }
  })
  .catch(() => map.setView([0, 0], 2));

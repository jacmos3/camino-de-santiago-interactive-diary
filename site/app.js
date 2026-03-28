(() => {
  if (typeof window === 'undefined') return;
  if (window.__CAMMINO_RENDERER_CORE_LOADED__) return;
  if (document.querySelector('[data-cammino-renderer-bootstrap]')) return;

  const current = document.currentScript;
  const currentUrl = current && current.src ? new URL(current.src, window.location.href) : null;
  const version = currentUrl ? currentUrl.search : '';
  const loadScript = (src, marker) => new Promise((resolve, reject) => {
    if (document.querySelector(`script[${marker}]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = `${src}${version}`;
    script.defer = true;
    script.setAttribute(marker, '1');
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });

  const bootstrapMarker = document.createElement('meta');
  bootstrapMarker.dataset.camminoRendererBootstrap = '1';
  document.head.appendChild(bootstrapMarker);

  loadScript('/renderer-env.js', 'data-cammino-renderer-env')
    .then(() => loadScript('/renderer-day-utils.js', 'data-cammino-renderer-day-utils'))
    .then(() => loadScript('/renderer-core.js', 'data-cammino-renderer-core'))
    .catch((error) => {
      console.error(error);
    });
})();

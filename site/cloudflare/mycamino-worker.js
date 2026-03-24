export default {
  async fetch(request) {
    const url = new URL(request.url);
    const originUrl = new URL(request.url);
    originUrl.hostname = 'mycamino.semproxlab.it';

    const headers = new Headers(request.headers);
    headers.set('Host', 'mycamino.semproxlab.it');
    headers.set('X-Canonical-Host', url.hostname);
    headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));

    const originRequest = new Request(originUrl.toString(), {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
      cf: {
        cacheEverything: false
      }
    });

    return fetch(originRequest);
  }
};

/* Service worker: guarda la aplicación en el teléfono para que abra sin internet.
   Estrategia: stale-while-revalidate (responde al instante desde el caché y lo actualiza en segundo plano).
   Al cambiar cualquier archivo de la app, subir el número de VERSION. */
const VERSION = 'el-gallinero-v3';
const ARCHIVOS = [
  './', 'index.html', 'css/app.css', 'js/app.js', 'manifest.webmanifest',
  'fonts/alfa-slab-one.ttf',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/logo-96.png', 'icons/icon-maskable-512.png',
];

self.addEventListener('install', e => {
  // Tolerante: si un archivo falla, los demás se guardan igual (addAll es todo o nada).
  e.waitUntil(
    caches.open(VERSION)
      .then(c => Promise.allSettled(ARCHIVOS.map(a => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const guardada = await cache.match(req, { ignoreSearch: true });
    const red = fetch(req).then(r => { if (r && r.status === 200) cache.put(req, r.clone()); return r; }).catch(() => null);
    if (guardada) { e.waitUntil(red); return guardada; }
    const r = await red;
    if (r) return r;
    // Sin red y sin copia: solo una navegación cae a index.html; un script o una imagen no deben recibir HTML.
    if (req.mode === 'navigate') { const inicio = await cache.match('index.html'); if (inicio) return inicio; }
    return Response.error();
  }));
});

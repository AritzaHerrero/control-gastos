// =========================================================
// Service worker — Control de gastos
// Estrategia "red primero": con conexión siempre carga la última
// versión (adiós a la caché vieja) y sin conexión abre la guardada.
// Las llamadas a Supabase (tus datos) nunca se cachean.
// =========================================================
const CACHE = 'gastos-v3';
const APP = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './util.js',
  './bloqueo.js',
  './graficos.js',
  './objetivos.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Datos y login de Supabase: siempre directo a la red
  if (url.hostname.endsWith('supabase.co')) return;

  // Solo la propia app, la librería de Supabase (esm.sh) y las fuentes
  const propio = url.origin === self.location.origin;
  const externo = ['esm.sh', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname);
  if (!propio && !externo) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const resp = await fetch(req, propio ? { cache: 'no-cache' } : undefined);
      if (resp.ok) cache.put(propio ? quitarVersion(req) : req, resp.clone());
      return resp;
    } catch {
      const guardada = await cache.match(propio ? quitarVersion(req) : req, { ignoreSearch: propio });
      if (guardada) return guardada;
      if (req.mode === 'navigate') return cache.match('./index.html');
      throw new Error('Sin conexión');
    }
  })());
});

// "app.js?v=4" y "app.js" se guardan como el mismo archivo
function quitarVersion(req) {
  const u = new URL(req.url);
  if (u.pathname.endsWith('/')) return new Request(u.origin + u.pathname);
  u.search = '';
  return new Request(u.toString());
}

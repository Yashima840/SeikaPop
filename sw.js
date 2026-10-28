// 電波の弱い売り場でも開けるように、アプリ本体と書体を端末に控えておく。
// アプリのファイルは「まずネットから、だめなら控え」＝更新がすぐ届く。
// 書体（Google Fonts）は変わらないので「控えがあれば控え」。
// ファイルを足したら SHELL にも足し、VERSION を上げること。

const VERSION = 'v22';
const SHELL_CACHE = `seikapop-shell-${VERSION}`;
const FONT_CACHE = 'seikapop-fonts';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/model.js', './js/layout.js', './js/image.js', './js/backup.js',
  './js/store.js', './js/frames.js', './js/templates.js', './js/price-design.js', './js/catch-design.js', './js/labels.js', './js/label-design.js', './js/render.js', './js/ui.js', './js/crash.js', './js/collect.js', './js/sender.js',
  './js/views/home.js', './js/views/editor.js', './js/views/settings.js', './js/views/ad.js', './js/views/stock.js',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/favicon-32.png', './icons/icon-maskable-512.png',
  './img/sample-potato.jpg',
  './img/badges/gold-brush.png',
  './img/badges/red-medal.png',
  './img/badges/gold-paint.png',
  './img/badges/green-medal.png',
  './img/badges/flower-frame.png',
];

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', ev => {
  ev.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('seikapop-shell-') && key !== SHELL_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    ev.respondWith((async () => {
      const cache = await caches.open(FONT_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    })());
    return;
  }
  if (url.origin !== self.location.origin) return;
  ev.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) (await caches.open(SHELL_CACHE)).put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});

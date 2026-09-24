/* Buyer Log — asgari service worker.
   Amaç: tarayıcının "uygulama olarak yükle" seçeneğini sunabilmesi.
   Hiçbir şeyi önbelleğe ALMAZ; tüm istekler her zaman canlı sunucuya gider
   (veri tazeliği bozulmasın diye bilinçli tercih). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* ağ geçişi: varsayılan davranış */ });

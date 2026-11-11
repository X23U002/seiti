// ==========================================
// オフライン用（service worker）
// ・このアプリの画面の部品（HTML・CSS・JS・画像）と、地図・Firebase などの部品を端末に残し、
//   電波が弱い所・圏外でもアプリを開けるようにする
// ・聖地のデータは、地図画面が端末に残したもの（seitiSpotCache）を使う
// ・地図の絵（Mapbox のタイル）は、Mapbox の決まりがあるのでここでは残さない（ブラウザに任せる）
// ・ページ（HTML）は、通信できれば最新を、できなければ残したものを出す
// ・部品は、残したものをすぐ出しつつ、裏で最新に入れかえる
// ・聖地の写真（images/spots/）は同じ名前のまま差し替えることがあるので、毎回サーバーに新しいかを確かめる
//   （変わっていなければ中身は送られてこないので軽い）。通信できない時だけ残したものを出す
// ==========================================
// 名前を変えると、前の版で残したもの（古い写真など）を消す
const CACHE = "seiti-v2";

// 先に残しておくもの（地図の画面を開くのに最低限いるもの）
const CORE = [
    "html/map.html",
    "manifest.webmanifest",
    "images/icons/icon-192.png"
];

// ほかのサイトでも残してよい部品（版の番号が付いていて、中身が変わらないもの）
const LIBRARIES = [
    "https://api.mapbox.com/mapbox-gl-js/",
    "https://api.mapbox.com/mapbox-gl-js/plugins/",
    "https://www.gstatic.com/firebasejs/",
    "https://cdn.jsdelivr.net/npm/three@"
];

self.addEventListener("install", function (event) {
    event.waitUntil(
        caches.open(CACHE)
            .then(function (cache) { return cache.addAll(CORE); })
            .then(function () { return self.skipWaiting(); })
    );
});

self.addEventListener("activate", function (event) {
    event.waitUntil(
        caches.keys()
            .then(function (keys) {
                return Promise.all(keys
                    .filter(function (key) { return key !== CACHE; })
                    .map(function (key) { return caches.delete(key); }));
            })
            .then(function () { return self.clients.claim(); })
    );
});

// 通信できれば最新を出して残す。できなければ残したもの
function networkFirst(request) {
    return fetch(request)
        .then(function (response) {
            if (response.ok) {
                const copy = response.clone();
                caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
            }
            return response;
        })
        .catch(function () {
            return caches.match(request, { ignoreSearch: true }).then(function (cached) {
                return cached || caches.match("html/map.html");
            });
        });
}

// 聖地の写真：ブラウザに残っていても、必ずサーバーに新しいかを確かめる。通信できなければ残したもの
function freshImage(request) {
    return fetch(request, { cache: "no-cache" })
        .then(function (response) {
            if (response.ok) {
                const copy = response.clone();
                caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
            }
            return response;
        })
        .catch(function () {
            return caches.match(request).then(function (cached) {
                return cached || Response.error();
            });
        });
}

// 残したものをすぐ出しつつ、裏で最新に入れかえる（残していなければ通信して残す）
function staleWhileRevalidate(request) {
    return caches.open(CACHE).then(function (cache) {
        return cache.match(request).then(function (cached) {
            const fresh = fetch(request)
                .then(function (response) {
                    if (response.ok || response.type === "opaque") {
                        cache.put(request, response.clone());
                    }
                    return response;
                })
                .catch(function () { return cached; });
            return cached || fresh;
        });
    });
}

self.addEventListener("fetch", function (event) {
    const request = event.request;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    const sameOrigin = url.origin === self.location.origin;

    if (sameOrigin && url.pathname.startsWith(new URL("images/spots/", self.location).pathname)) {
        event.respondWith(freshImage(request));
        return;
    }

    if (sameOrigin && url.pathname.startsWith(new URL("./", self.location).pathname)) {
        event.respondWith(
            request.mode === "navigate" ? networkFirst(request) : staleWhileRevalidate(request)
        );
        return;
    }

    if (LIBRARIES.some(function (prefix) { return request.url.startsWith(prefix); })) {
        event.respondWith(staleWhileRevalidate(request));
    }
    // それ以外（Firestore・地図のタイル・AI など）は残さず、そのまま通信する
});

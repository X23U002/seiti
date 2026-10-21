// =========================================================
// 1. Firebase の読み込みと設定
// =========================================================
import {
    getApp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";

import {
    getAnalytics
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-analytics.js";

import {
    collection,
    getDocs
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// Firebase の接続（ログイン・DB）は他の画面と共通
// （ブラウザに古い firebase-db.js が残っていても動くよう、前からある db と getCurrentUser だけを使う）
import { db, getCurrentUser } from "./firebase-db.js";

// 作品名と作品ごとの色（スタンプ帳・マイページと共通）
import {
    getTitleColor,
    getTitleName
} from "./title-colors.js";

// 何期の何話の場面か（入力された期・話、無ければ説明文から。お気に入り一覧と共通）
// ※ ?v= を付けて、ブラウザに残った古い episode.js を使わないようにする
import { getSpotEpisodeLabel } from "./episode.js?v=2";

// お気に入り・保存したルート
import {
    loadFavorites,
    saveRoute,
    setFavorite
} from "./saved-db.js";

// stampsyori.js（スタンプ獲得の演出）からも同じ色を使う
window.getTitleColor = getTitleColor;

// firebase-db.js が作った Firebase の接続でアクセス解析を付ける
getAnalytics(getApp());


// =========================================================
// 2. Mapbox の基本設定とUI状態
// =========================================================
mapboxgl.accessToken =
    "pk.eyJ1Ijoia3Vyb211IiwiYSI6ImNtcDBqcGpjNjB3Y2EycnE2a3d6cGhmbG4ifQ.lQ-HQ1PQVvgpxSvj8J_9rA";

let is3D = false;
let spotMarkers = [];
let spots = [];

// stampsyori.jsからスポット一覧を参照できるようにする
window.spots = spots;

let currentSpots = [];
let titleMap = {};
let hoverPopup = null;

// =========================================================
// 作品ごとのピンの色
// データの読み込み順で色が変わらないよう、作品ごとに色を固定する。
// ここに無い作品は、作品名から決まる色（毎回同じ色）になる
// =========================================================
const titleColorMap = {};

const map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/standard",
    center: [
        139.7671,
        35.6812
    ],
    zoom: 12,
    pitch: 0,
    bearing: 0,
    minZoom: 6,
    maxZoom: 18
});


// 初期状態（2D）はピッチ変更禁止
map.touchPitch.disable();

// PCの回転は有効
map.dragRotate.enable();

// スマホの2本指回転は有効
map.touchZoomRotate.enableRotation();


map.on("style.load", () => {
    map.setConfigProperty(
        "basemap",
        "language",
        "ja"
    );
});


map.on("pitch", () => {
    if (
        !is3D &&
        map.getPitch() !== 0
    ) {
        map.setPitch(0);
    }
});


map.addControl(
    new mapboxgl.NavigationControl(),
    "top-right"
);


// =========================================================
// 現在地コントロール
// =========================================================
const geolocate =
    new mapboxgl.GeolocateControl({
        positionOptions: {
            enableHighAccuracy: true
        },

        trackUserLocation: true,
        showUserHeading: true
    });

map.addControl(
    geolocate,
    "top-right"
);

// stampsyori.jsから現在地コントロールを参照できるようにする
window.geolocate = geolocate;

// =========================================================
// 現在地に歩く3Dキャラクターを表示（walker.js）
// 読み込みに失敗しても地図は使えるよう、別に読み込む
// =========================================================
import("./walker.js")
    .then(function (walker) {
        walker.initWalker(
            map,
            geolocate
        );
    })
    .catch(function (error) {
        console.warn(
            "3Dキャラクターを表示できませんでした:",
            error
        );
    });


// =========================================================
// あいまい検索用の文字変換
// =========================================================
function normalizeText(text) {
    if (!text) {
        return "";
    }

    return String(text)
        .toLowerCase()

        .replace(
            /[Ａ-Ｚａ-ｚ０-９]/g,
            function (character) {
                return String.fromCharCode(
                    character.charCodeAt(0) -
                    0xFEE0
                );
            }
        )

        .replace(
            /[\u30a1-\u30f6]/g,
            function (character) {
                return String.fromCharCode(
                    character.charCodeAt(0) -
                    0x60
                );
            }
        )

        .replace(
            /[  ・！!？\?△○〇\-ー。、，,．.【】「」『』（）()〔〕［］\[\]“”"'’〜~：:]/g,
            ""
        );
}

// =========================================================
// 作品の略称（検索欄に略称を入れても作品の聖地が出るように）
// キー：略称、値：Firestore の title_name
// =========================================================
const TITLE_ALIASES = {
    "ガルクラ": "ガールズバンドクライ",
    "ユーフォ": "響け！ユーフォニアム",
    "響け": "響け！ユーフォニアム",
    "俺ガイル": "やはり俺の青春ラブコメはまちがっている。",
    "はまち": "やはり俺の青春ラブコメはまちがっている。",
    "かぐや姫": "超かぐや姫！",
    "青ブタ": "青春ブタ野郎はバニーガール先輩の夢を見ない",
    "ゆるキャン": "ゆるキャン△",
    "冴えカノ": "冴えない彼女の育てかた",
    "リコリコ": "リコリス・リコイル",
    "推しの子": "【推しの子】",
    "鬼滅": "鬼滅の刃"
};

// 入力が略称（またはその一部）なら、対応する作品名を返す
function findAliasTitles(keyword) {
    return Object.keys(TITLE_ALIASES)
        .filter(function (alias) {
            const normalizedAlias = normalizeText(alias);
            return normalizedAlias.includes(keyword) || keyword.includes(normalizedAlias);
        })
        .map(function (alias) {
            return normalizeText(TITLE_ALIASES[alias]);
        });
}


// =========================================================
// HTMLエスケープ
// =========================================================
function escapeHTML(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


// =========================================================
// 3. データの取得
// =========================================================
// 作品名が無いスポットは「その他」として扱う
// （色分け・絞り込みのリストと同じ名前にそろえる）


async function loadData() {
    const spotSnapshot =
        await getDocs(
            collection(
                db,
                "spot"
            )
        );

    spots = [];

    spotSnapshot.forEach(
        function (docSnap) {
            const data =
                docSnap.data();

            if (!data.coord) {
                return;
            }

            const titleName =
                data.title_name ||
                "その他";

            titleColorMap[
                titleName
            ] =
                getTitleColor(
                    titleName
                );

            spots.push({
                id: docSnap.id,
                ...data
            });
        }
    );

    currentSpots = spots;

    saveSpotSummary();

    // stampsyori.jsへ最新のスポット一覧を渡す
    window.spots = spots;

    if (
        typeof window.refreshStampUI ===
        "function"
    ) {
        window.refreshStampUI();
    }
}


// =========================================================
// 作品ごとの聖地の件数と色を端末に記録する
// （マイページの「作品ごとの達成度」で使う）
// =========================================================
function saveSpotSummary() {
    const titles = {};

    spots.forEach(
        function (spot) {
            const title =
                getTitleName(spot);

            if (!titles[title]) {
                titles[title] = {
                    count: 0,
                    color: getTitleColor(title)
                };
            }
            titles[title].count++;
        }
    );

    try {
        localStorage.setItem(
            "seitiSpotSummary",
            JSON.stringify({
                updatedAt: Date.now(),
                total: spots.length,
                titles: titles,
                // スタンプ画面で「まだ集めていない聖地」も並べるための一覧
                spots: spots.map(
                    function (spot) {
                        return {
                            id: spot.id,
                            name: spot.spot_name || "無題のスポット",
                            title: getTitleName(spot),
                            info: spot.spot_info || ""
                        };
                    }
                )
            })
        );
    } catch (error) {
        // 保存できない環境では何もしない
    }
}


// =========================================================
// map.html?spot=スポットID で開いた時は、その聖地へ移動して詳細を開く
// （スタンプ画面の「地図で見る」から使う）。処理した時は true を返す
// =========================================================
function openSpotFromUrl() {
    const spotId =
        new URLSearchParams(
            location.search
        ).get("spot");

    if (!spotId) {
        return false;
    }

    const spot =
        spots.find(
            function (item) {
                return String(item.id) === spotId;
            }
        );

    if (!spot || !spot.coord) {
        return false;
    }

    map.jumpTo({
        center: [
            Number(spot.coord.longitude),
            Number(spot.coord.latitude)
        ],
        zoom: 16
    });

    // ピンが描き直された後に、そのスポットの詳細を開く
    map.once(
        "idle",
        function () {
            openSpotMarker(spotId);
        }
    );

    return true;
}


// =========================================================
// map.html?route=ID,ID,... で開いた時は、そのルートを組み立てて全体を表示する
// （「お気に入り・ルート・履歴」画面の保存したルートから使う）
// =========================================================
function openRouteFromUrl() {
    const param =
        new URLSearchParams(
            location.search
        ).get("route");

    if (!param) {
        return false;
    }

    param
        .split(",")
        .forEach(
            function (spotId) {
                window.addSpotToRouteById(
                    spotId,
                    { silent: true }
                );
            }
        );

    if (selectedSpots.length === 0) {
        window.showToast(
            "ルートの聖地が見つかりませんでした",
            "error"
        );
        return false;
    }

    // 保存したルートを開いたばかりなので「保存済み」にしておく
    lastSavedRouteKey = getRouteKey();
    updateSaveRouteButton();

    const bounds = new mapboxgl.LngLatBounds();
    selectedSpots.forEach(
        function (spot) {
            bounds.extend([
                spot.longitude,
                spot.latitude
            ]);
        }
    );

    map.fitBounds(
        bounds,
        {
            padding: 80,
            maxZoom: 16,
            duration: 0
        }
    );

    window.showToast(
        `保存したルート（${selectedSpots.length}か所）を開きました`
    );

    return true;
}


// =========================================================
// 地図上にあるピンから、そのスポットの詳細を開く
// =========================================================
function openSpotMarker(spotId) {
    const target =
        spotMarkers.find(
            function (marker) {
                return marker.getElement().dataset.spotId === String(spotId);
            }
        );
    if (target && target.getPopup() && !target.getPopup().isOpen()) {
        target.togglePopup();
    }
}


// =========================================================
// 別の聖地へ移動して詳細を開く（詳細の「近くの聖地」から使う）
// =========================================================
function goToSpot(spotId) {
    const spot =
        spots.find(
            function (item) {
                return String(item.id) === String(spotId);
            }
        );

    if (!spot || !spot.coord) {
        return;
    }

    // 今開いている詳細を閉じてから移動する
    spotMarkers.forEach(
        function (marker) {
            const popup = marker.getPopup();
            if (popup && popup.isOpen()) {
                popup.remove();
            }
        }
    );

    map.flyTo({
        center: [
            Number(spot.coord.longitude),
            Number(spot.coord.latitude)
        ],
        zoom: Math.max(map.getZoom(), 15),
        duration: prefersReducedMotion() ? 0 : 1200
    });

    // 移動してピンが描き直された後に開く
    map.once(
        "idle",
        function () {
            openSpotMarker(spotId);
        }
    );
}


function getEpisodeBadgeHTML(spot) {
    const label =
        getSpotEpisodeLabel(spot);

    return label
        ? `<span class="popup-ep">${escapeHTML(label)}</span>`
        : "";
}


// =========================================================
// 2地点の距離（メートル）と、その表示
// =========================================================
function getDistanceMeters(a, b) {
    const toRad = Math.PI / 180;
    const lat1 = Number(a.latitude) * toRad;
    const lat2 = Number(b.latitude) * toRad;
    const dLat = lat2 - lat1;
    const dLng = (Number(b.longitude) - Number(a.longitude)) * toRad;
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

    return 6371000 * 2 * Math.asin(Math.sqrt(h));
}

function formatDistance(meters) {
    if (meters < 1000) {
        return Math.max(10, Math.round(meters / 10) * 10) + "m";
    }

    return (meters / 1000).toFixed(meters < 10000 ? 1 : 0) + "km";
}


// =========================================================
// スポット詳細の「近くの聖地」
// 同じ作品の聖地を近い順に表示する（遠すぎるものは出さない）
// =========================================================
const NEARBY_MAX_COUNT = 4;
const NEARBY_MAX_METERS = 30000;

function getNearbySpots(spot) {
    if (!spot.coord) {
        return [];
    }

    const titleName = getTitleName(spot);

    return spots
        .filter(
            function (item) {
                return (
                    item.id !== spot.id &&
                    item.coord &&
                    getTitleName(item) === titleName
                );
            }
        )
        .map(
            function (item) {
                return {
                    spot: item,
                    distance: getDistanceMeters(spot.coord, item.coord)
                };
            }
        )
        .filter(
            function (item) {
                return (
                    Number.isFinite(item.distance) &&
                    item.distance <= NEARBY_MAX_METERS
                );
            }
        )
        .sort(
            function (a, b) {
                return a.distance - b.distance;
            }
        )
        .slice(0, NEARBY_MAX_COUNT);
}

function renderNearbySpots(container, spot) {
    if (!container) {
        return;
    }

    const nearby = getNearbySpots(spot);

    container.hidden = nearby.length === 0;

    if (nearby.length === 0) {
        container.innerHTML = "";
        return;
    }

    container.innerHTML = `
        <strong>近くの「${escapeHTML(getTitleName(spot))}」の聖地</strong>
        <ul class="popup-nearby-list">
            ${nearby.map(
                function (item) {
                    const collected =
                        typeof window.hasCollectedStamp === "function" &&
                        window.hasCollectedStamp(item.spot.id);

                    return `
                        <li>
                            <button type="button" class="popup-nearby-item" data-spot-id="${escapeHTML(String(item.spot.id))}">
                                ${getEpisodeBadgeHTML(item.spot)}
                                <span class="popup-nearby-name">${escapeHTML(item.spot.spot_name || "無題のスポット")}</span>
                                ${collected ? '<span class="popup-nearby-done" title="スタンプ獲得済み" aria-label="獲得済み">✓</span>' : ""}
                                <span class="popup-nearby-distance">${formatDistance(item.distance)}</span>
                            </button>
                        </li>
                    `;
                }
            ).join("")}
        </ul>
    `;

    container
        .querySelectorAll(".popup-nearby-item")
        .forEach(
            function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        goToSpot(button.dataset.spotId);
                    }
                );
            }
        );
}


// =========================================================
// お気に入り（ハート）
// ログインしている人だけ使える。DB（favorite）に保存する
// =========================================================
const HEART_ICON =
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>';

const SHARE_ICON =
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/></svg>';

const favoriteIds = new Set();

function syncFavoriteButtons(root) {
    (root || document)
        .querySelectorAll(".popup-fav")
        .forEach(
            function (button) {
                button.setAttribute(
                    "aria-pressed",
                    String(favoriteIds.has(button.dataset.spotId))
                );
            }
        );
}

// ログインしていればお気に入りを読み込む（失敗しても地図はそのまま使える）
async function loadFavoriteIds() {
    try {
        const favorites = await loadFavorites();
        (favorites || []).forEach(
            function (item) {
                favoriteIds.add(item.spotId);
            }
        );
        syncFavoriteButtons();
    } catch (error) {
        console.warn("お気に入りを読み込めませんでした:", error);
    }
}

async function toggleFavorite(button) {
    const spotId = button.dataset.spotId;

    if (!(await getCurrentUser())) {
        window.showToast(
            "お気に入りはログインすると使えます",
            "error"
        );
        return;
    }

    const on = !favoriteIds.has(spotId);

    // 先に見た目を変えて、保存できなかったら戻す
    if (on) {
        favoriteIds.add(spotId);
    } else {
        favoriteIds.delete(spotId);
    }
    syncFavoriteButtons();
    button.disabled = true;

    try {
        await setFavorite(spotId, on);
        window.showToast(
            on
                ? "お気に入りに追加しました"
                : "お気に入りから外しました"
        );
    } catch (error) {
        console.error("お気に入りを保存できませんでした:", error);

        if (on) {
            favoriteIds.delete(spotId);
        } else {
            favoriteIds.add(spotId);
        }
        syncFavoriteButtons();

        window.showToast(
            "お気に入りを保存できませんでした",
            "error"
        );
    } finally {
        button.disabled = false;
    }
}


// =========================================================
// 共有
// スマホでは共有メニュー（LINE など）を開き、使えない時はリンクをコピーする。
// リンクを開くと、地図でその聖地の詳細が開く（map.html?spot=ID）
// =========================================================
function getSpotShareURL(spotId) {
    const url = new URL("map.html", location.href);
    url.searchParams.set("spot", spotId);
    return url.href;
}

async function shareSpot(spotId) {
    const spot =
        spots.find(
            function (item) {
                return String(item.id) === String(spotId);
            }
        );

    if (!spot) {
        return;
    }

    const url = getSpotShareURL(spot.id);
    const text =
        `「${getTitleName(spot)}」の聖地「${spot.spot_name || "無題のスポット"}」`;

    if (navigator.share) {
        try {
            await navigator.share({
                title: spot.spot_name || "聖地巡礼NAVI",
                text: text,
                url: url
            });
            return;
        } catch (error) {
            // 共有メニューを閉じただけの時は何もしない
            if (error && error.name === "AbortError") {
                return;
            }
        }
    }

    try {
        await navigator.clipboard.writeText(text + "\n" + url);
        window.showToast("リンクをコピーしました");
    } catch (error) {
        window.prompt("このリンクをコピーしてください", url);
    }
}

// 詳細の中のハート・共有ボタン（詳細は何度も作り直されるので、まとめて受け取る）
document.addEventListener(
    "click",
    function (event) {
        const favoriteButton = event.target.closest(".popup-fav");
        if (favoriteButton) {
            toggleFavorite(favoriteButton);
            return;
        }

        const shareButton = event.target.closest(".popup-share");
        if (shareButton) {
            shareSpot(shareButton.dataset.spotId);
        }
    }
);


// =========================================================
// ピンを押した時のカメラ
// ピンを中心にして、地図をゆっくり1周させる（3D表示なら斜めから見下ろす）。
// 地図を触ったり詳細を閉じたりしたら止める。
// 「視差効果を減らす」設定の端末では回さない
// =========================================================
const ORBIT_DEGREES_PER_SECOND = 8;

let orbitFrame = null;
let orbitToken = 0;

function prefersReducedMotion() {
    return window.matchMedia(
        "(prefers-reduced-motion: reduce)"
    ).matches;
}

function stopOrbit() {
    orbitToken++;

    if (orbitFrame) {
        cancelAnimationFrame(orbitFrame);
        orbitFrame = null;
    }

    setOrbiting(false);
}

// 回転中かどうか（smoothMarker で使う）
let isOrbiting = false;

function setOrbiting(orbiting) {
    isOrbiting = orbiting;
}

// Mapbox はピンの位置を毎回整数の画素に丸めるので、ゆっくり回すと
// 他のピンが1pxずつカクカク動いて震えて見える。
// 回転中だけは丸める前の位置で描いて、なめらかに動かす。
// （Mapbox の内部の仕組みを使うので、無い版では何もしない＝今までどおり）
function smoothMarker(marker) {
    const updateDOM = marker._updateDOM;

    if (typeof updateDOM !== "function" || typeof marker._lngLat === "undefined") {
        return;
    }

    marker._updateDOM = function () {
        if (isOrbiting && this._map && this._lngLat) {
            this._pos = this._map.project(this._lngLat, this._altitude);
        }

        return updateDOM.apply(this, arguments);
    };
}

// 詳細に隠れないよう、ピンを見えている部分の真ん中に置く
// スマホ：詳細が画面下半分を覆うので上寄り／広い画面：詳細が左に出るので右寄り
const SPOT_PANEL_SPACE = 360 + 16 * 2; // 左の詳細パネルの幅＋余白（style.css と合わせる）

function getSpotPadding() {
    const isMobile =
        window.matchMedia(
            "(max-width: 600px)"
        ).matches;

    const container = map.getContainer();

    const padding = {
        top: 0,
        right: 0,
        bottom: isMobile ? Math.round(container.clientHeight * 0.5) : 0,
        left: isMobile ? 0 : Math.min(SPOT_PANEL_SPACE, Math.round(container.clientWidth * 0.5))
    };

    // 地図の中心が 327.5px のような半端な位置だと、回転中にピンが
    // 1px ずつ左右に行ったり来たりして震えて見える（Mapbox がピンの位置を整数に丸めるため）。
    // 中心がちょうど整数の位置になるよう 1px だけ調整する
    if ((container.clientWidth - padding.left - padding.right) % 2 === 1) {
        padding.right += 1;
    }
    if ((container.clientHeight - padding.top - padding.bottom) % 2 === 1) {
        padding.bottom += 1;
    }

    return padding;
}

function focusSpotCamera(longitude, latitude) {
    stopOrbit();

    const token = orbitToken;
    const reduced = prefersReducedMotion();

    // ズームは変えない（変えるとピンが描き直されて詳細が閉じてしまうため）
    map.easeTo({
        center: [
            longitude,
            latitude
        ],
        pitch: is3D ? 60 : 0,
        padding: getSpotPadding(),
        duration: reduced ? 0 : 900
    });

    if (reduced) {
        return;
    }

    map.once(
        "moveend",
        function () {
            if (token !== orbitToken) {
                return;
            }

            const startBearing = map.getBearing();
            let turned = 0;
            let last = performance.now();

            function step(now) {
                if (token !== orbitToken) {
                    return;
                }

                turned += (now - last) / 1000 * ORBIT_DEGREES_PER_SECOND;
                last = now;

                // 1周したら元の向きで止める
                if (turned >= 360) {
                    map.setBearing(startBearing);
                    orbitFrame = null;
                    setOrbiting(false);
                    return;
                }

                map.setBearing(startBearing + turned);
                orbitFrame = requestAnimationFrame(step);
            }

            setOrbiting(true);
            orbitFrame = requestAnimationFrame(step);
        }
    );
}

// 地図を触ったら回転を止める
["mousedown", "touchstart", "wheel"].forEach(
    function (type) {
        map.on(type, stopOrbit);
    }
);

map.on(
    "movestart",
    function (event) {
        if (event.originalEvent) {
            stopOrbit();
        }
    }
);

geolocate.on("trackuserlocationstart", stopOrbit);


// =========================================================
// ポップアップの「ルートに追加」ボタン
// ルートに入っている間は「追加済み」にして押せなくする
// =========================================================
const ROUTE_ADD_ICON =
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

const ROUTE_ADDED_ICON =
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17L4 12"/></svg>';

function getRouteButtonHTML(isInRoute) {
    return isInRoute
        ? ROUTE_ADDED_ICON + "追加済み"
        : ROUTE_ADD_ICON + "ルートに追加";
}

function setRouteButtonState(button, isInRoute) {
    button.disabled = isInRoute;
    button.innerHTML = getRouteButtonHTML(isInRoute);
}

// 画面にある「ルートに追加」ボタンを、今のルートに合わせる
function syncRouteButtons(root) {
    (root || document)
        .querySelectorAll(
            '[id^="route-btn-"]'
        )
        .forEach(
            function (button) {
                const spotId =
                    button.id.slice(
                        "route-btn-".length
                    );

                setRouteButtonState(
                    button,
                    selectedSpots.some(
                        function (item) {
                            return String(item.id) === spotId;
                        }
                    )
                );
            }
        );
}


// =========================================================
// スポット詳細のポップアップ
// スマホでは画面下からせり上がるパネルとして表示する（見た目は style.css）。
// パネルにピンが隠れないよう、開いた時にピンを画面の上寄りへ動かす
// =========================================================
// 詳細を開いているピンに印を付ける。
// Mapbox は霧（遠くをかすませる効果）の濃さに合わせてピンと詳細を半透明にするが、
// 画面に固定した詳細パネルや選んだピンまで薄くなって読みにくくなるため、
// この印が付いたピンは style.css で不透明のままにする
function setSelectedMarker(spotId, selected) {
    document
        .querySelectorAll(
            `.mapboxgl-marker[data-spot-id="${CSS.escape(String(spotId))}"]`
        )
        .forEach(
            function (element) {
                element.classList.toggle("is-selected", selected);
            }
        );
}

function createSpotPopup(html, data, longitude, latitude) {
    const popup =
        new mapboxgl.Popup({
            offset: 25
        }).setHTML(
            html
        );

    popup.on(
        "open",
        function () {
            // 閉じている間にルートやお気に入りが変わっていることがあるので合わせ直す
            syncRouteButtons(
                popup.getElement()
            );
            syncFavoriteButtons(
                popup.getElement()
            );

            // 近くの聖地は開いた時に作る（スタンプの✓も最新にするため）
            renderNearbySpots(
                popup.getElement().querySelector(".popup-nearby"),
                data
            );

            setSelectedMarker(data.id, true);

            focusSpotCamera(
                longitude,
                latitude
            );
        }
    );

    popup.on(
        "close",
        function () {
            stopOrbit();
            setSelectedMarker(data.id, false);

            // 開いている詳細が無くなったら、地図の中心を元に戻す
            setTimeout(
                function () {
                    if (!document.querySelector(".mapboxgl-popup .popup-card")) {
                        map.easeTo({
                            padding: { top: 0, right: 0, bottom: 0, left: 0 },
                            duration: prefersReducedMotion() ? 0 : 300
                        });
                    }
                },
                0
            );
        }
    );

    return popup;
}


// =========================================================
// GeoHashでグループ化
// =========================================================
function groupSpotsByGeohash(list) {
    const zoom =
        map.getZoom();

    let geohashLength;

    if (zoom <= 7) {
        geohashLength = 3;
    } else {
        geohashLength = 4;
    }

    const groups = {};

    list.forEach(
        function (data) {
            if (!data.geo_hash) {
                return;
            }

            const key =
                data.geo_hash.substring(
                    0,
                    geohashLength
                );

            if (!groups[key]) {
                groups[key] = [];
            }

            groups[key].push(data);
        }
    );

    return Object.values(groups);
}


// =========================================================
// マーカー描画
// =========================================================
function drawMarkers(list) {
    spotMarkers.forEach(
        function (spotMarker) {
            spotMarker.remove();
        }
    );

    spotMarkers = [];

    const zoom =
        map.getZoom();


    // =====================================================
    // ズーム10以下はスポットをまとめて表示
    // =====================================================
    if (zoom <= 10) {
        const groups =
            groupSpotsByGeohash(list);

        groups.forEach(
            function (group) {
                const data =
                    group[0];

                const longitude =
                    Number(
                        data.coord
                            ?.longitude
                    );

                const latitude =
                    Number(
                        data.coord
                            ?.latitude
                    );

                if (
                    !Number.isFinite(
                        longitude
                    ) ||
                    !Number.isFinite(
                        latitude
                    )
                ) {
                    return;
                }

                const element =
                    document.createElement(
                        "div"
                    );

                element.textContent =
                    group.length;

                element.style.width =
                    "25px";

                element.style.height =
                    "25px";

                element.style.borderRadius =
                    "50%";

                element.style.backgroundColor =
                    "deepskyblue";

                element.style.color =
                    "white";

                element.style.fontWeight =
                    "bold";

                element.style.display =
                    "flex";

                element.style.justifyContent =
                    "center";

                element.style.alignItems =
                    "center";

                element.style.border =
                    "2px solid white";

                element.style.cursor =
                    "pointer";

                const displaySpots =
                    group.slice(
                        0,
                        3
                    );

                let hoverHTML =
                    displaySpots
                        .map(
                            function (spot) {
                                return escapeHTML(
                                    spot.spot_name ||
                                    "無題のスポット"
                                );
                            }
                        )
                        .join("<br>");

                if (
                    group.length > 3
                ) {
                    hoverHTML +=
                        `<br>...あと${group.length - 3}件`;
                }

                const groupMarker =
                    new mapboxgl.Marker(
                        element
                    )
                        .setLngLat([
                            longitude,
                            latitude
                        ])
                        .addTo(map);

                groupMarker
                    .getElement()
                    .addEventListener(
                        "click",
                        function () {
                            if (
                                hoverPopup
                            ) {
                                hoverPopup.remove();
                            }

                            hoverPopup =
                                new mapboxgl.Popup({
                                    closeButton: false,
                                    closeOnClick: false,
                                    offset: 15
                                })
                                    .setLngLat([
                                        longitude,
                                        latitude
                                    ])
                                    .setHTML(
                                        hoverHTML
                                    )
                                    .addTo(map);
                        }
                    );

                spotMarkers.push(
                    groupMarker
                );
            }
        );

        return;
    }


    // =====================================================
    // ズーム11以上は個別スポットを表示
    // =====================================================
    list.forEach(
        function (data) {
            const longitude =
                Number(
                    data.coord
                        ?.longitude
                );

            const latitude =
                Number(
                    data.coord
                        ?.latitude
                );

            if (
                !Number.isFinite(
                    longitude
                ) ||
                !Number.isFinite(
                    latitude
                )
            ) {
                return;
            }

            const titleName =
                getTitleName(data);

            const spotName =
                data.spot_name ||
                "無題のスポット";

            // 画像が無いスポットは image_url が "no_image"（古いデータは "not_image"）
            const hasImage =
                Boolean(data.image_url) &&
                data.image_url !== "no_image" &&
                data.image_url !== "not_image";

            const titleColor =
                titleColorMap[
                    titleName
                ] ||
                "#0b3c5d";

            // 公式サイトのURL（http/httpsの時だけボタンを表示する）
            const titleURL =
                /^https?:\/\//i.test(
                    data.title_url || ""
                )
                    ? data.title_url
                    : "";

            const homeButtonHTML =
                titleURL
                    ? `
                        <a
                            href="${escapeHTML(titleURL)}"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="popup-home"
                            aria-label="作品の公式サイトを開く"
                            title="作品の公式サイト"
                        >
                            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>
                        </a>
                    `
                    : "";


            // =============================================
            // stampsyori.jsからスタンプ取得ボタンを受け取る
            // =============================================
            const stampHTML =
                typeof window
                    .getStampPopupHTML ===
                "function"

                    ? window
                        .getStampPopupHTML(
                            data
                        )

                    : "";


            // =============================================
            // ポップアップ
            // =============================================
            // ルートに追加済みなら、描き直した後も「追加済み」のままにする
            const isInRoute =
                selectedSpots.some(
                    function (item) {
                        return item.id === data.id;
                    }
                );
            const popupHTML = `
                <div class="popup-card">

                    <div class="popup-meta">
                        <div
                            class="popup-title"
                            style="background:${titleColor};"
                        >
                            ${escapeHTML(titleName)}
                        </div>
                        ${getEpisodeBadgeHTML(data)}
                        <div class="popup-actions">
                            <button
                                type="button"
                                class="popup-icon-btn popup-fav"
                                data-spot-id="${escapeHTML(String(data.id))}"
                                aria-pressed="${favoriteIds.has(String(data.id))}"
                                aria-label="お気に入り"
                                title="お気に入り"
                            >
                                ${HEART_ICON}
                            </button>
                            <button
                                type="button"
                                class="popup-icon-btn popup-share"
                                data-spot-id="${escapeHTML(String(data.id))}"
                                aria-label="この聖地を共有"
                                title="共有"
                            >
                                ${SHARE_ICON}
                            </button>
                        </div>
                    </div>

                    <h2 class="popup-spot">
                        ${escapeHTML(spotName)}
                    </h2>

                    <div class="popup-section">
                        <strong>
                            登場シーン
                        </strong>

                        <p>
                            ${escapeHTML(
                                data.scene ||
                                data.spot_info ||
                                "情報がありません"
                            )}
                        </p>
                    </div>

                    ${hasImage
                        ? `<div class="popup-image">
                            <img
                                src="${escapeHTML(data.image_url)}"
                                alt="スポット画像"
                                onerror="this.parentNode.classList.add('no-image')"
                            >
                        </div>`
                        : '<div class="popup-image no-image"></div>'}

                    <!-- スタンプ取得ボタン -->
                    ${stampHTML}

                    <div class="popup-buttons">

                        ${homeButtonHTML}

                        <button
                            type="button"
                            id="route-btn-${data.id}"
                            onclick="addSpotToRouteById('${data.id}')"
                            ${isInRoute ? "disabled" : ""}
                        >
                            ${getRouteButtonHTML(isInRoute)}
                        </button>

                    </div>

                    <!-- 近くの聖地（開いた時に作る） -->
                    <div class="popup-section popup-nearby" hidden></div>

                </div>
            `;


            const spotMarker =
                new mapboxgl.Marker({
                    color:
                        titleColor
                })
                    .setLngLat([
                        longitude,
                        latitude
                    ])
                    .setPopup(
                        createSpotPopup(
                            popupHTML,
                            data,
                            longitude,
                            latitude
                        )
                    )
                    .addTo(map);


            // 回転中に震えないようにする
            smoothMarker(spotMarker);

            // stampsyori.jsがマーカーを判別するために必要
            spotMarker
                .getElement()
                .dataset
                .spotId =
                    String(data.id);


            if (
                typeof window
                    .hasCollectedStamp ===
                    "function" &&
                window.hasCollectedStamp(
                    data.id
                )
            ) {
                spotMarker
                    .getElement()
                    .classList
                    .add(
                        "stamp-completed-marker"
                    );
            }


            spotMarkers.push(
                spotMarker
            );
        }
    );
}


// =========================================================
// ズーム後にマーカーを描き直す
// =========================================================
map.on(
    "zoomend",
    function () {
        if (hoverPopup) {
            hoverPopup.remove();
            hoverPopup = null;
        }

        drawMarkers(
            currentSpots
        );
    }
);


// =========================================================
// 地図をクリックしたらグループポップアップを閉じる
// =========================================================
map.on(
    "click",
    function (event) {
        if (
            !event.originalEvent
                .target
                .closest(
                    ".mapboxgl-marker"
                )
        ) {
            if (hoverPopup) {
                hoverPopup.remove();
                hoverPopup = null;
            }
        }
    }
);


// =========================================================
// 4. カスタム検索機能
// =========================================================
function searchCustomSpots(query) {
    const keyword =
        normalizeText(query);
    if (!keyword) {
        return [];
    }

    // 略称で入力された時の作品名
    const aliasTitles =
        findAliasTitles(keyword);

    const matches =
        spots.filter(
            function (spot) {
                const spotName =
                    normalizeText(
                        spot.spot_name
                    );

                const titleName =
                    normalizeText(
                        getTitleName(
                            spot
                        )
                    );

                const spotInfo =
                    normalizeText(
                        spot.spot_info
                    );

                return (
                    spotName.includes(
                        keyword
                    ) ||
                    titleName.includes(
                        keyword
                    ) ||
                    spotInfo.includes(
                        keyword
                    ) ||
                    aliasTitles.includes(
                        titleName
                    )
                );
            }
        );

    return matches.map(
        function (spot) {
            const title =
                getTitleName(
                    spot
                );

            const spotName =
                spot.spot_name ||
                title ||
                "無題のスポット";

            return {
                type: "Feature",

                geometry: {
                    type: "Point",

                    coordinates: [
                        Number(
                            spot.coord
                                ?.longitude
                        ),

                        Number(
                            spot.coord
                                ?.latitude
                        )
                    ]
                },

                place_name:
                    `🌟 ${spotName} (作品: ${title})`,

                properties: {
                    isCustomSpot: true,
                    id: spot.id
                }
            };
        }
    );
}


// =========================================================
// 検索ボックス
// =========================================================
function initializeSearchBox() {
    const container =
        document.getElementById(
            "search-container"
        );

    if (!container) {
        return;
    }

    container.innerHTML = "";

    const geocoder =
        new MapboxGeocoder({
            accessToken:
                mapboxgl.accessToken,

            mapboxgl:
                mapboxgl,

            marker:
                true,

            placeholder:
                "場所・住所・駅名・スポットを検索",

            localGeocoder:
                searchCustomSpots,
            localGeocoderOnly:
                false,
            // 住所・地名の検索は日本国内・日本語に絞り、
            // 今見ている場所の近くを優先する
            countries:
                "jp",
            language:
                "ja",
            // 候補の最大件数（聖地が多い作品でも多めに出るように。指定できる最大は10）
            limit:
                10,
            proximity: {
                longitude: map.getCenter().lng,
                latitude: map.getCenter().lat
            }
        });

    // 地図を動かしたら「近く」の基準も更新する
    map.on(
        "moveend",
        function () {
            const center =
                map.getCenter();
            geocoder.setProximity({
                longitude: center.lng,
                latitude: center.lat
            });
        }
    );

    // 聖地が1件も見つからない時は知らせる（入力が止まってから1回だけ）
    let noSpotTimer = null;
    geocoder.on(
        "results",
        function (event) {
            clearTimeout(noSpotTimer);
            const input =
                container.querySelector("input");
            const query =
                input ? input.value.trim() : "";
            if (
                normalizeText(query).length < 2 ||
                searchCustomSpots(query).length > 0
            ) {
                return;
            }
            noSpotTimer =
                setTimeout(
                    function () {
                        if (typeof window.showToast === "function") {
                            window.showToast(
                                `「${query}」に該当する聖地はありません（住所・地名の候補を表示しています）`,
                                "error"
                            );
                        }
                    },
                    800
                );
        }
    );

    container.appendChild(
        geocoder.onAdd(map)
    );


    geocoder.on(
        "result",
        function (event) {
            const feature =
                event.result;

            if (
                feature.properties &&
                feature.properties
                    .isCustomSpot
            ) {
                const selectedSpot =
                    spots.find(
                        function (spot) {
                            return (
                                spot.id ===
                                feature
                                    .properties
                                    .id
                            );
                        }
                    );

                if (selectedSpot) {
                    currentSpots = [
                        selectedSpot
                    ];

                    drawMarkers(
                        currentSpots
                    );

                    if (
                        geocoder.mapMarker
                    ) {
                        geocoder
                            .mapMarker
                            .remove();
                    }

                    // 地図の移動（ズーム）が終わるとピンが描き直されて
                    // 先に開いた吹き出しが消えるため、移動と描画が終わってから開く
                    setTimeout(
                        function () {
                            map.once(
                                "idle",
                                function () {
                                    if (
                                        spotMarkers
                                            .length > 0 &&
                                        spotMarkers[0].getPopup() &&
                                        !spotMarkers[0].getPopup().isOpen()
                                    ) {
                                        spotMarkers[0]
                                            .togglePopup();
                                    }
                                }
                            );
                        },
                        100
                    );
                }
            } else {
                applyActiveFilter();
            }
        }
    );


    geocoder.on(
        "clear",
        function () {
            applyActiveFilter();
        }
    );
}


// =========================================================
// 地図読み込み
// =========================================================
map.on(
    "load",
    async function () {
        // データ読み込み
        try {
            await loadData();
        } catch (error) {
            console.error(
                "データの読み込みに失敗:",
                error
            );
        }


        // ピン描画
        try {
            drawMarkers(
                spots
            );
        } catch (error) {
            console.error(
                "ピンの描画に失敗:",
                error
            );
        }


        // 検索バー表示
        try {
            initializeSearchBox();
        } catch (error) {
            console.error(
                "検索バーの表示に失敗:",
                error
            );
        }


        // ログインしていればお気に入りを読み込む（待たずに進める）
        loadFavoriteIds();

        // URLで聖地やルートが指定されていれば、そこを表示する
        // （その時は現在地へカメラが動かないよう、現在地の自動取得はしない）
        let openedSpot = false;
        try {
            openedSpot =
                openRouteFromUrl() ||
                openSpotFromUrl();
        } catch (error) {
            console.warn(
                "指定された聖地を開けませんでした:",
                error
            );
        }

        // 現在地取得
        try {
            if (!openedSpot) geolocate.trigger();
        } catch (error) {
            console.warn(
                "現在地の取得に失敗:",
                error
            );
        }
    }
);


// =========================================================
// 5. UIイベントとその他の操作
// =========================================================
// ※ 以前あった「長押しでピンを立てる」処理は、立てたピンをどこでも使っておらず
//   スマホで地図を長押しすると謎のピンが出るだけだったので削除した

// =========================================================
// サイドメニュー
// =========================================================
window.toggleMenu =
    function () {
        document
            .getElementById(
                "side-menu"
            )
            .classList
            .toggle(
                "open"
            );

        document
            .getElementById(
                "hamburger-btn"
            )
            .classList
            .toggle(
                "active"
            );
    };


// =========================================================
// 2D・3D切り替え
// =========================================================
window.toggleView =
    function () {
        const button =
            document.getElementById(
                "toggle-view-btn"
            );

        stopOrbit();

        if (!is3D) {
            map.touchPitch.enable();

            map.easeTo({
                pitch: 70,
                bearing: -20,
                duration: 1500
            });

            button.classList.add(
                "mode3d"
            );

            // 3Dの時だけ、遠くのピンを霧でかすませる（style.css）
            map.getContainer().classList.add("is-3d");
            button.setAttribute(
                "aria-pressed",
                "true"
            );

            is3D = true;
        } else {
            map.touchPitch.disable();

            map.setPitch(0);

            map.easeTo({
                pitch: 0,
                bearing: 0,
                duration: 1500
            });

            button.classList.remove(
                "mode3d"
            );

            map.getContainer().classList.remove("is-3d");
            button.setAttribute(
                "aria-pressed",
                "false"
            );

            is3D = false;
        }
    };


// =========================================================
// 現在地ボタン
// =========================================================
window.moveToCurrentLocation =
    function () {
        geolocate.trigger();
    };


// =========================================================
// 6. アニメで絞り込み
// =========================================================

// 今かかっている絞り込み（チェックした作品名と、入力したキーワード）
const activeFilter = {
    titles: [],
    keyword: ""
};

// 絞り込みの条件に合うスポットを返す（条件が無ければ全件）
function filterSpots() {
    const keyword =
        normalizeText(
            activeFilter.keyword
        );

    if (
        keyword === "" &&
        activeFilter.titles.length === 0
    ) {
        return spots;
    }

    return spots.filter(
        function (spot) {
            const rawTitle =
                getTitleName(spot);

            const isMatchKeyword =
                keyword !== "" &&
                normalizeText(rawTitle).includes(keyword);

            const isMatchCheck =
                activeFilter.titles.includes(rawTitle);

            return isMatchKeyword || isMatchCheck;
        }
    );
}

// 絞り込みを地図に反映する
function applyActiveFilter() {
    currentSpots =
        filterSpots();

    drawMarkers(
        currentSpots
    );

    renderFilterChips();
}

// 検索バーの下に「絞り込み中の作品」の札を並べる（× で1つずつ外せる）
function renderFilterChips() {
    const area =
        document.getElementById(
            "filter-chips"
        );

    if (!area) {
        return;
    }

    area.innerHTML = "";

    activeFilter.titles.forEach(
        function (title) {
            area.appendChild(
                createFilterChip(
                    title,
                    getTitleColor(title),
                    function () {
                        activeFilter.titles =
                            activeFilter.titles.filter(
                                function (item) {
                                    return item !== title;
                                }
                            );
                        applyActiveFilter();
                    }
                )
            );
        }
    );

    if (activeFilter.keyword) {
        area.appendChild(
            createFilterChip(
                `「${activeFilter.keyword}」`,
                null,
                function () {
                    activeFilter.keyword = "";
                    applyActiveFilter();
                }
            )
        );
    }

    // 絞り込み中はボタンの色を変えて分かるようにする
    document
        .getElementById(
            "filter-btn"
        )
        ?.classList
        .toggle(
            "is-active",
            area.children.length > 0
        );
}

function createFilterChip(label, color, onRemove) {
    const chip =
        document.createElement(
            "button"
        );
    chip.type = "button";
    chip.className = "filter-chip";
    chip.setAttribute(
        "aria-label",
        `${label} の絞り込みを解除`
    );

    if (color) {
        const dot =
            document.createElement(
                "span"
            );
        dot.className = "color-dot";
        dot.style.background = color;
        chip.appendChild(dot);
    }

    chip.appendChild(
        document.createTextNode(
            label
        )
    );

    const cross =
        document.createElement(
            "span"
        );
    cross.className = "chip-x";
    cross.setAttribute(
        "aria-hidden",
        "true"
    );
    cross.textContent = "×";
    chip.appendChild(cross);

    chip.onclick = onRemove;
    return chip;
}

// 絞り込み画面の作品一覧（ピンの色と件数つき）
function populateAnimeList() {
    const listContainer =
        document.getElementById(
            "anime-list"
        );

    if (!listContainer) {
        return;
    }

    listContainer.innerHTML = "";

    Object.keys(
        titleColorMap
    ).forEach(
        function (title) {
            if (!title) {
                return;
            }

            const label =
                document.createElement(
                    "label"
                );

            const checkbox =
                document.createElement(
                    "input"
                );
            checkbox.type = "checkbox";
            checkbox.value = title;
            // 今絞り込んでいる作品にはチェックを付けておく
            checkbox.checked =
                activeFilter.titles.includes(title);

            // ピンと同じ色の丸（凡例）
            const dot =
                document.createElement(
                    "span"
                );
            dot.className = "color-dot";
            dot.style.background =
                getTitleColor(title);

            const name =
                document.createElement(
                    "span"
                );
            name.className = "anime-name";
            name.textContent = title;

            const count =
                document.createElement(
                    "span"
                );
            count.className = "anime-count";
            count.textContent =
                spots.filter(
                    function (spot) {
                        return getTitleName(spot) === title;
                    }
                ).length + "件";

            label.append(
                checkbox,
                dot,
                name,
                count
            );

            listContainer.appendChild(
                label
            );
        }
    );
}

// =========================================================
// 絞り込み画面を開く
// =========================================================
window.openFilter =
    function () {
        populateAnimeList();

        const searchInput =
            document.getElementById(
                "anime-search"
            );

        // 今の絞り込みの状態を表示しておく
        searchInput.value =
            activeFilter.keyword;

        searchInput.onkeydown =
            function (event) {
                if (
                    event.key ===
                    "Enter"
                ) {
                    event.preventDefault();
                    window.applyFilter();
                }
            };

        window.searchAnime();

        document
            .getElementById(
                "filter-modal"
            )
            .style
            .display =
                "block";
    };

// =========================================================
// 絞り込み画面を閉じる
// =========================================================
window.closeFilter =
    function () {
        document
            .getElementById(
                "filter-modal"
            )
            .style
            .display =
                "none";
    };


// =========================================================
// 作品検索（絞り込み画面の一覧を、入力した作品名で絞る）
// =========================================================
window.searchAnime =
    function () {
        const keyword =
            normalizeText(
                document.getElementById(
                    "anime-search"
                ).value
            );

        document
            .querySelectorAll(
                "#anime-list label"
            )
            .forEach(
                function (label) {
                    const title =
                        normalizeText(
                            label.querySelector("input").value
                        );

                    // "" にするとCSS側の表示方法（flex）に戻る
                    label.style.display =
                        title.includes(keyword)
                            ? ""
                            : "none";
                }
            );
    };

// =========================================================
// 絞り込み適用
// =========================================================
window.applyFilter =
    function () {
        const previous = {
            titles: activeFilter.titles.slice(),
            keyword: activeFilter.keyword
        };

        activeFilter.keyword =
            document
                .getElementById(
                    "anime-search"
                )
                .value
                .trim();

        activeFilter.titles =
            Array.from(
                document.querySelectorAll(
                    "#anime-list input[type='checkbox']:checked"
                )
            ).map(
                function (checkbox) {
                    return checkbox.value;
                }
            );

        // 1件も無い時は元の絞り込みに戻し、画面は閉じずに知らせる
        if (filterSpots().length === 0) {
            activeFilter.titles = previous.titles;
            activeFilter.keyword = previous.keyword;
            window.showToast(
                "入力された作品名のスポットは見つかりませんでした",
                "error"
            );
            return;
        }

        applyActiveFilter();
        window.closeFilter();
    };

// =========================================================
// 絞り込みリセット
// =========================================================
window.resetFilter =
    function () {
        document.getElementById(
            "anime-search"
        ).value = "";

        document
            .querySelectorAll(
                "#anime-list input[type='checkbox']"
            )
            .forEach(
                function (checkbox) {
                    checkbox.checked = false;
                }
            );

        window.searchAnime();

        activeFilter.titles = [];
        activeFilter.keyword = "";
        applyActiveFilter();
    };

// =========================================================
// 7. 経路案内
// =========================================================
const selectedSpots = [];

window.selectedSpots =
    selectedSpots;


// IDを使ってルートへ追加
window.addSpotToRouteById =
    function (spotId, options) {
        // silent：保存したルートを開く時など、1件ごとのお知らせを出さない
        const silent =
            Boolean(options && options.silent);

        const spot =
            spots.find(
                function (item) {
                    return (
                        String(item.id) ===
                        String(spotId)
                    );
                }
            );

        if (
            !spot ||
            !spot.coord
        ) {
            if (silent) {
                return;
            }

            window.showToast(
                "スポットデータが見つかりません",
                "error"
            );

            return;
        }

        const latitude =
            Number(
                spot.coord.latitude
            );

        const longitude =
            Number(
                spot.coord.longitude
            );

        if (
            selectedSpots.some(
                function (item) {
                    return (
                        item.id ===
                        spot.id
                    );
                }
            )
        ) {
            if (!silent) {
                window.showToast(
                    "この場所はすでにルートに追加されています",
                    "error"
                );
            }

            return;
        }

        selectedSpots.push({
            id: spot.id,

            name:
                spot.spot_name ||
                getTitleName(spot) ||
                "無題のスポット",

            latitude:
                latitude,

            longitude:
                longitude
        });

        document
            .getElementById(
                "routePanel"
            )
            .style
            .display =
                "flex";

        updateRouteList();

        syncRouteButtons();

        if (!silent) {
            window.showToast(
                `「${selectedSpots[selectedSpots.length - 1].name}」をルートに追加しました`
            );
        }

    };


// =========================================================
// ルートから1件削除
// =========================================================
window.removeSpotFromRoute =
    function (spotId) {
        const index =
            selectedSpots.findIndex(
                function (spot) {
                    return (
                        spot.id ===
                        spotId
                    );
                }
            );

        if (index !== -1) {
            selectedSpots.splice(
                index,
                1
            );

            updateRouteList();
            syncRouteButtons();

            if (
                selectedSpots.length ===
                0
            ) {
                document
                    .getElementById(
                        "routePanel"
                    )
                    .style
                    .display =
                        "none";
            }
        }
    };


// =========================================================
// ルートを全削除
// =========================================================
window.clearSelectedSpots =
    function () {
        selectedSpots.length = 0;

        updateRouteList();
        syncRouteButtons();

        document
            .getElementById(
                "routePanel"
            )
            .style
            .display =
                "none";
    };


// =========================================================
// ルート一覧更新
// =========================================================
function updateRouteList() {
    const routeList =
        document.getElementById(
            "routeList"
        );

    if (!routeList) {
        return;
    }

    routeList.innerHTML = "";

    // パネルの見出しに件数を表示
    const routeCount =
        document.getElementById(
            "route-count"
        );
    if (routeCount) {
        routeCount.textContent =
            selectedSpots.length;
    }

    // ルートが変わったら「このルートを保存」を押せるようにする
    updateSaveRouteButton();

    if (
        selectedSpots.length === 0
    ) {
        routeList.innerHTML =
            '<p class="route-empty">行きたい場所はありません</p>';

        return;
    }

    selectedSpots.forEach(
        function (spot, index) {
            const routeItem =
                document.createElement(
                    "div"
                );

            routeItem.className =
                "routeItem";

            routeItem.dataset.index =
                index;

            // ドラッグで並べ替えるためのつまみ（スマホのタッチでも動く）
            const handle =
                document.createElement(
                    "span"
                );

            handle.className =
                "route-handle";

            handle.textContent =
                "⠿";

            handle.title =
                "ドラッグで並べ替え";

            handle.setAttribute(
                "aria-hidden",
                "true"
            );

            handle.addEventListener(
                "pointerdown",
                startRouteDrag
            );

            const nameSpan =
                document.createElement(
                    "span"
                );

            nameSpan.className =
                "route-name";

            nameSpan.textContent =
                `${index + 1}. ${spot.name}`;

            // ▲▼ボタンで1つずつ入れ替える
            const moveButtons =
                document.createElement(
                    "div"
                );

            moveButtons.className =
                "route-move";

            moveButtons.appendChild(
                createRouteMoveButton(
                    "▲",
                    `「${spot.name}」を1つ前へ`,
                    index,
                    index - 1
                )
            );

            moveButtons.appendChild(
                createRouteMoveButton(
                    "▼",
                    `「${spot.name}」を1つ後ろへ`,
                    index,
                    index + 1
                )
            );

            const removeButton =
                document.createElement(
                    "button"
                );

            removeButton.type =
                "button";

            removeButton.className =
                "route-remove";

            removeButton.textContent =
                "×";

            removeButton.setAttribute(
                "aria-label",
                `「${spot.name}」をルートから外す`
            );

            removeButton.onclick =
                function () {
                    window.removeSpotFromRoute(
                        spot.id
                    );
                };

            routeItem.appendChild(
                handle
            );

            routeItem.appendChild(
                nameSpan
            );

            routeItem.appendChild(
                moveButtons
            );

            routeItem.appendChild(
                removeButton
            );

            routeList.appendChild(
                routeItem
            );
        }
    );
}


// ▲▼ボタンを作る（端の項目では押せないようにする）
function createRouteMoveButton(label, ariaLabel, fromIndex, toIndex) {
    const button =
        document.createElement(
            "button"
        );

    button.type =
        "button";

    button.textContent =
        label;

    button.setAttribute(
        "aria-label",
        ariaLabel
    );

    button.disabled =
        toIndex < 0 ||
        toIndex >= selectedSpots.length;

    button.onclick =
        function () {
            window.moveRouteSpot(
                fromIndex,
                toIndex
            );

            // 続けて押せるように、移動先の同じボタンにフォーカスを戻す
            const moved =
                document.querySelector(
                    `#routeList .routeItem[data-index="${toIndex}"] .route-move button:nth-child(${label === "▲" ? 1 : 2})`
                );

            if (moved && !moved.disabled) {
                moved.focus();
            }
        };

    return button;
}


// =========================================================
// ルートの順番を入れ替える
// =========================================================
window.moveRouteSpot =
    function (fromIndex, toIndex) {
        if (
            fromIndex === toIndex ||
            toIndex < 0 ||
            toIndex >= selectedSpots.length
        ) {
            return;
        }

        const moved =
            selectedSpots.splice(
                fromIndex,
                1
            )[0];

        selectedSpots.splice(
            toIndex,
            0,
            moved
        );

        updateRouteList();
    };


// ドラッグ中の項目を、指（マウス）の位置に合わせて一覧の中で動かす
function startRouteDrag(event) {
    const item =
        event.currentTarget.closest(
            ".routeItem"
        );

    const routeList =
        document.getElementById(
            "routeList"
        );

    const fromIndex =
        Number(
            item.dataset.index
        );

    event.preventDefault();

    item.classList.add(
        "dragging"
    );

    function onMove(moveEvent) {
        const siblings =
            Array.from(
                routeList.querySelectorAll(
                    ".routeItem:not(.dragging)"
                )
            );

        // 指より下にある最初の項目の手前へ入れる
        const next =
            siblings.find(
                function (sibling) {
                    const rect =
                        sibling.getBoundingClientRect();

                    return (
                        moveEvent.clientY <
                        rect.top + rect.height / 2
                    );
                }
            );

        routeList.insertBefore(
            item,
            next || null
        );

        // 一覧の端に来たら自動でスクロールする
        const listRect =
            routeList.getBoundingClientRect();

        if (moveEvent.clientY < listRect.top + 24) {
            routeList.scrollTop -= 8;
        } else if (moveEvent.clientY > listRect.bottom - 24) {
            routeList.scrollTop += 8;
        }
    }

    function onEnd() {
        document.removeEventListener(
            "pointermove",
            onMove
        );

        document.removeEventListener(
            "pointerup",
            onEnd
        );

        document.removeEventListener(
            "pointercancel",
            onEnd
        );

        const toIndex =
            Array.from(
                routeList.querySelectorAll(
                    ".routeItem"
                )
            ).indexOf(
                item
            );

        item.classList.remove(
            "dragging"
        );

        if (toIndex === fromIndex) {
            updateRouteList();
        } else {
            window.moveRouteSpot(
                fromIndex,
                toIndex
            );
        }
    }

    document.addEventListener(
        "pointermove",
        onMove
    );

    document.addEventListener(
        "pointerup",
        onEnd
    );

    document.addEventListener(
        "pointercancel",
        onEnd
    );
}


// =========================================================
// Googleマップへ渡す
// =========================================================
window.openGoogleMapsRoute =
    function () {
        if (
            selectedSpots.length === 0
        ) {
            window.showToast(
                "行きたい場所を追加してください",
                "error"
            );

            return;
        }

        const locations =
            selectedSpots.map(
                function (spot) {
                    return (
                        `${spot.latitude},${spot.longitude}`
                    );
                }
            );

        const destination =
            locations[
                locations.length - 1
            ];

        const waypoints =
            locations
                .slice(
                    0,
                    -1
                )
                .join("|");

        let url =
            "https://www.google.com/maps/dir/?" +
            "api=1" +
            `&destination=${encodeURIComponent(destination)}`;

        if (waypoints) {
            url +=
                `&waypoints=${encodeURIComponent(waypoints)}`;
        }

        url +=
            "&travelmode=walking";

        window.open(
            url,
            "_blank"
        );
    };


// =========================================================
// HTML読み込み後に経路ボタンを接続
// =========================================================
// type="module" はHTML読み込み後に実行されるので、待たずにそのまま接続できる
document
    .getElementById(
        "open-google-route"
    )
    ?.addEventListener(
        "click",
        window.openGoogleMapsRoute
    );

document
    .getElementById(
        "clear-route"
    )
    ?.addEventListener(
        "click",
        window.clearSelectedSpots
    );


// =========================================================
// ルートを保存する（DBの root）
// 保存したルートは「お気に入り・ルート・履歴」画面から開ける
// =========================================================
let lastSavedRouteKey = "";
let isSavingRoute = false;

function getRouteKey() {
    return selectedSpots
        .map(
            function (spot) {
                return spot.id;
            }
        )
        .join(",");
}

// 今のルートを保存済みなら「保存済み」にする
function updateSaveRouteButton() {
    const button =
        document.getElementById(
            "save-route"
        );

    if (!button) {
        return;
    }

    const saved =
        selectedSpots.length > 0 &&
        getRouteKey() === lastSavedRouteKey;

    button.disabled = saved || isSavingRoute;
    button.textContent =
        isSavingRoute
            ? "保存中…"
            : saved
                ? "保存済み"
                : "このルートを保存";
}

document
    .getElementById(
        "save-route"
    )
    ?.addEventListener(
        "click",
        async function () {
            if (selectedSpots.length === 0) {
                return;
            }

            if (!(await getCurrentUser())) {
                window.showToast(
                    "ルートの保存はログインすると使えます",
                    "error"
                );
                return;
            }

            const key = getRouteKey();
            isSavingRoute = true;
            updateSaveRouteButton();

            try {
                await saveRoute(
                    selectedSpots.map(
                        function (spot) {
                            return spot.id;
                        }
                    )
                );
                lastSavedRouteKey = key;
                window.showToast(
                    "ルートを保存しました（マイページから開けます）"
                );
            } catch (error) {
                console.error("ルートを保存できませんでした:", error);
                window.showToast(
                    "ルートを保存できませんでした",
                    "error"
                );
            } finally {
                isSavingRoute = false;
                updateSaveRouteButton();
            }
        }
    );
// ==========================================
// デバッグ：マウスがある場所の座標を記録
// ==========================================
window.debugStampMousePosition = null;

map.on(
    "mousemove",

    function (event) {
        window.debugStampMousePosition = {
            latitude:
                event.lngLat.lat,

            longitude:
                event.lngLat.lng
        };
    }
);
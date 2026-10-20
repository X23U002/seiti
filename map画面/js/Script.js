// =========================================================
// 1. Firebase の読み込みと設定
// =========================================================
import {
    getApp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";

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

// 聖地の画像（GitHub の map画面/images/spots/ に置いたもの）
import { getSpotImageSrc } from "./spot-image.js?v=2";

// おすすめ聖地巡礼ルート
import {
    COURSE_COLLECTION,
    courseDistance,
    formatCourseLength,
    sortCourses
} from "./course.js";

// お気に入り・保存したルート
import {
    loadFavorites,
    saveRoute,
    setFavorite
} from "./saved-db.js";

// stampsyori.js（スタンプ獲得の演出）からも同じ色を使う
window.getTitleColor = getTitleColor;

// firebase-db.js が作った Firebase の接続でアクセス解析を付ける
// （広告ブロックなどで読み込めなくても地図は動くよう、別に読み込む）
import("https://www.gstatic.com/firebasejs/12.15.0/firebase-analytics.js")
    .then(function (analytics) {
        analytics.getAnalytics(getApp());
    })
    .catch(function (error) {
        console.warn("アクセス解析を読み込めませんでした:", error);
    });


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


// 聖地の一覧を使えるようにする（色・絞り込み・スタンプ画面にも反映する）
function setSpots(list) {
    spots = [];

    list.forEach(
        function (data) {
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

            spots.push(data);
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

// 位置は { latitude, longitude } の形にそろえる（端末に記録できるように）
function toSpot(id, data) {
    const spot = Object.assign({ id: id }, data);

    if (data.coord) {
        spot.coord = {
            latitude: Number(data.coord.latitude),
            longitude: Number(data.coord.longitude)
        };
    }

    return spot;
}

// ---------- Firestore から読む（ふつうの方法） ----------
async function fetchSpotsFromFirestore() {
    const spotSnapshot =
        await getDocs(
            collection(
                db,
                "spot"
            )
        );

    const list = [];

    spotSnapshot.forEach(
        function (docSnap) {
            list.push(
                toSpot(docSnap.id, docSnap.data())
            );
        }
    );

    return list;
}

// ---------- Firestore の Web API から読む（予備） ----------
// 広告ブロックの拡張機能などで Firestore の通信（…/channel）が止められると、
// ふつうの読み込みが終わらなくなる。聖地は誰でも読めるので、別の入り口から読む
const FIRESTORE_REST_URL =
    "https://firestore.googleapis.com/v1/projects/sisukai-121cf/databases/(default)/documents/";

function fromRestValue(value) {
    if (!value || typeof value !== "object") return null;
    if ("stringValue" in value) return value.stringValue;
    if ("integerValue" in value) return Number(value.integerValue);
    if ("doubleValue" in value) return Number(value.doubleValue);
    if ("booleanValue" in value) return value.booleanValue;
    if ("geoPointValue" in value) {
        return {
            latitude: Number(value.geoPointValue.latitude || 0),
            longitude: Number(value.geoPointValue.longitude || 0)
        };
    }
    if ("timestampValue" in value) return value.timestampValue;
    if ("arrayValue" in value) {
        return (value.arrayValue.values || []).map(fromRestValue);
    }
    return null;
}

// collectionName のドキュメントを全部読む（{ id, ...項目 } の配列）
async function fetchCollectionFromRest(collectionName) {
    const list = [];
    let pageToken = "";

    do {
        const url =
            FIRESTORE_REST_URL +
            collectionName +
            "?pageSize=300" +
            (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error("Web API から読めませんでした: " + response.status);
        }

        const json = await response.json();

        (json.documents || []).forEach(
            function (doc) {
                const data = {};
                Object.keys(doc.fields || {}).forEach(
                    function (key) {
                        data[key] = fromRestValue(doc.fields[key]);
                    }
                );
                list.push(
                    Object.assign({ id: doc.name.split("/").pop() }, data)
                );
            }
        );

        pageToken = json.nextPageToken || "";
    } while (pageToken);

    return list;
}

async function fetchSpotsFromRest() {
    const list = await fetchCollectionFromRest("spot");
    return list.map(
        function (item) {
            const { id, ...data } = item;
            return toSpot(id, data);
        }
    );
}

// 時間内に終わらなければ失敗にする
function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise(function (resolve, reject) {
            setTimeout(function () {
                reject(new Error(ms / 1000 + "秒以内に読み込めませんでした"));
            }, ms);
        })
    ]);
}

// ---------- 前回読み込んだ聖地（すぐにピンを出すため、端末に記録しておく） ----------
const SPOT_CACHE_KEY = "seitiSpotCache";

function readSpotCache() {
    try {
        const list = JSON.parse(localStorage.getItem(SPOT_CACHE_KEY) || "null");
        return Array.isArray(list) ? list : null;
    } catch (error) {
        return null;
    }
}

function writeSpotCache(list) {
    try {
        localStorage.setItem(SPOT_CACHE_KEY, JSON.stringify(list));
    } catch (error) {
        // 保存できない環境では何もしない
    }
}

// 最新の聖地を読む：Firestore（8秒まで）→ だめなら Web API
const FIRESTORE_TIMEOUT_MS = 8000;

async function fetchLatestSpots() {
    try {
        return await withTimeout(
            fetchSpotsFromFirestore(),
            FIRESTORE_TIMEOUT_MS
        );
    } catch (error) {
        console.warn(
            "Firestore から聖地を読めなかったので、Web API から読みます:",
            error
        );
        return fetchSpotsFromRest();
    }
}

// 地図の準備と同時に読み始める（地図の読み込みを待たない）
const latestSpotsPromise =
    fetchLatestSpots();

// 前回の聖地があれば、すぐに使えるようにしておく
const cachedSpots =
    readSpotCache();

if (cachedSpots) {
    setSpots(cachedSpots);
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

    fitRouteBounds();

    window.showToast(
        `保存したルート（${selectedSpots.length}か所）を開きました`
    );

    return true;
}


// =========================================================
// おすすめ聖地巡礼ルート（管理者が作ったもの。course コレクション）
// 地図のメニュー「おすすめルート」と、聖地の詳細の「この聖地を通るおすすめルート」から選ぶと、
// そのままルート案内に入る
// =========================================================
let courses = [];

async function fetchCoursesFromFirestore() {
    const snapshot =
        await getDocs(
            collection(
                db,
                COURSE_COLLECTION
            )
        );

    const list = [];
    snapshot.forEach(
        function (docSnap) {
            list.push(
                Object.assign({ id: docSnap.id }, docSnap.data())
            );
        }
    );
    return list;
}

// 聖地と同じく、Firestore で読めなければ Web API から読む
async function loadCourses() {
    let list;

    try {
        list = await withTimeout(
            fetchCoursesFromFirestore(),
            FIRESTORE_TIMEOUT_MS
        );
    } catch (error) {
        try {
            list = await fetchCollectionFromRest(COURSE_COLLECTION);
        } catch (restError) {
            console.warn("おすすめルートを読み込めませんでした:", restError);
            list = [];
        }
    }

    courses = sortCourses(
        list.filter(
            function (course) {
                return Array.isArray(course.spot_ids) && course.spot_ids.length > 0;
            }
        )
    );

    // 開いている詳細があれば、この聖地を通るルートを出し直す
    document
        .querySelectorAll(".popup-courses")
        .forEach(
            function (container) {
                renderSpotCourses(container, container.dataset.spotId);
            }
        );
}

function findSpot(spotId) {
    return spots.find(
        function (item) {
            return String(item.id) === String(spotId);
        }
    );
}

// ルートの聖地（削除された聖地は除く）
function getCourseSpots(course) {
    return course.spot_ids
        .map(findSpot)
        .filter(
            function (spot) {
                return spot && spot.coord;
            }
        );
}

// 「5か所・約2.4km・徒歩 約40分」
function getCourseSummary(course) {
    const courseSpots = getCourseSpots(course);
    return courseSpots.length + "か所・" + formatCourseLength(courseDistance(courseSpots));
}

// ルート案内に入れたスポットが全部入るように地図を動かす
function fitRouteBounds() {
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
            duration: prefersReducedMotion() ? 0 : 800
        }
    );
}

// おすすめルートでルート案内を始める（今のルート案内は入れかわる）
function startCourse(courseId) {
    const course = courses.find(
        function (item) {
            return item.id === courseId;
        }
    );

    if (!course) {
        return;
    }

    window.clearSelectedSpots();

    course.spot_ids.forEach(
        function (spotId) {
            window.addSpotToRouteById(
                spotId,
                { silent: true }
            );
        }
    );

    if (selectedSpots.length === 0) {
        window.showToast(
            "このルートの聖地が見つかりませんでした",
            "error"
        );
        return;
    }

    // 開いている詳細・メニューを閉じてから、ルート全体を見せる
    spotMarkers.forEach(
        function (marker) {
            const popup = marker.getPopup();
            if (popup && popup.isOpen()) {
                popup.remove();
            }
        }
    );
    window.closeCourses();
    if (document.getElementById("side-menu").classList.contains("open")) {
        window.toggleMenu();
    }

    fitRouteBounds();

    window.showToast(
        `「${course.course_name}」（${selectedSpots.length}か所）をルート案内に入れました`
    );
}

// ---------- メニューの「おすすめルート」 ----------
window.openCourses =
    function () {
        if (document.getElementById("side-menu").classList.contains("open")) {
            window.toggleMenu();
        }

        renderCourseList();

        document
            .getElementById(
                "course-modal"
            )
            .style
            .display =
                "block";

        document
            .querySelector("#course-modal .filter-header button")
            .focus();
    };

window.closeCourses =
    function () {
        document
            .getElementById(
                "course-modal"
            )
            .style
            .display =
                "none";
    };

function renderCourseList() {
    const list =
        document.getElementById(
            "course-list"
        );

    list.innerHTML = "";

    if (courses.length === 0) {
        const empty = document.createElement("p");
        empty.className = "course-empty";
        empty.textContent = "まだおすすめルートはありません。";
        list.appendChild(empty);
        return;
    }

    // 作品で絞り込み中なら、その作品のルートを先に出す
    const ordered = courses.slice().sort(
        function (a, b) {
            return Number(activeFilter.titles.includes(b.title_name)) -
                Number(activeFilter.titles.includes(a.title_name));
        }
    );

    let lastTitle = null;

    ordered.forEach(
        function (course) {
            const courseSpots = getCourseSpots(course);

            if (courseSpots.length === 0) {
                return;
            }

            if (course.title_name !== lastTitle) {
                lastTitle = course.title_name;

                const heading = document.createElement("h3");
                heading.className = "course-work";
                const dot = document.createElement("span");
                dot.className = "course-work-dot";
                dot.style.background = getTitleColor(course.title_name || "その他");
                heading.append(dot, course.title_name || "その他");
                list.appendChild(heading);
            }

            const card = document.createElement("article");
            card.className = "course-card";

            const name = document.createElement("h4");
            name.textContent = course.course_name || "おすすめルート";

            const meta = document.createElement("p");
            meta.className = "course-meta";
            meta.textContent = getCourseSummary(course);

            card.append(name, meta);

            if (course.description) {
                const description = document.createElement("p");
                description.className = "course-description";
                description.textContent = course.description;
                card.appendChild(description);
            }

            const stops = document.createElement("ol");
            stops.className = "course-stops";
            courseSpots.forEach(
                function (spot) {
                    const li = document.createElement("li");
                    li.textContent = spot.spot_name || "無題のスポット";
                    stops.appendChild(li);
                }
            );

            const button = document.createElement("button");
            button.type = "button";
            button.className = "course-start";
            button.dataset.courseId = course.id;
            button.textContent = "このルートで巡る";

            card.append(stops, button);
            list.appendChild(card);
        }
    );
}

// ---------- 聖地の詳細の「おすすめルート」 ----------
// ピンを押した聖地と同じ作品のおすすめルートを出す。
// この聖地を通るルートは「この聖地を通る」の印を付けて先に並べる
function renderSpotCourses(container, spotId) {
    if (!container) {
        return;
    }

    const spot = findSpot(spotId);
    const titleName = spot ? getTitleName(spot) : "";
    const passes = function (course) {
        return course.spot_ids.map(String).includes(String(spotId));
    };

    const list = courses
        .filter(
            function (course) {
                return (passes(course) || (titleName && course.title_name === titleName)) &&
                    getCourseSpots(course).length > 0;
            }
        )
        .sort(
            function (a, b) {
                return Number(passes(b)) - Number(passes(a));
            }
        );

    container.hidden = list.length === 0;
    container.innerHTML = "";

    if (list.length === 0) {
        return;
    }

    const title = document.createElement("strong");
    title.textContent = titleName
        ? "「" + titleName + "」のおすすめルート"
        : "おすすめルート";
    container.appendChild(title);

    list.forEach(
        function (course) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "popup-course course-start";
            button.dataset.courseId = course.id;

            const head = document.createElement("span");
            head.className = "popup-course-head";

            const name = document.createElement("span");
            name.className = "popup-course-name";
            name.textContent = course.course_name || "おすすめルート";
            head.appendChild(name);

            if (passes(course)) {
                const badge = document.createElement("span");
                badge.className = "popup-course-badge";
                badge.textContent = "この聖地を通る";
                head.appendChild(badge);
            }

            const meta = document.createElement("span");
            meta.className = "popup-course-meta";
            meta.textContent = getCourseSummary(course);

            // 回る順（この聖地は太字）
            const stops = document.createElement("span");
            stops.className = "popup-course-stops";
            getCourseSpots(course).forEach(
                function (item, index) {
                    if (index > 0) {
                        stops.append(" → ");
                    }
                    const stop = document.createElement(
                        String(item.id) === String(spotId) ? "b" : "span"
                    );
                    stop.textContent = item.spot_name || "無題のスポット";
                    stops.appendChild(stop);
                }
            );

            button.append(head, meta, stops);
            container.appendChild(button);
        }
    );
}

// 「このルートで巡る」（メニューと詳細の両方。詳細は何度も作り直されるので、まとめて受け取る）
document.addEventListener(
    "click",
    function (event) {
        const button = event.target.closest(".course-start[data-course-id]");
        if (button) {
            startCourse(button.dataset.courseId);
        }
    }
);

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

    // 検索で1か所だけ表示している時などは、移動先のピンが地図に無いので、
    // 絞り込みどおりの表示に戻してから移動する（それでも無ければ移動先を足す）
    const isShown = function () {
        return currentSpots.some(
            function (item) {
                return String(item.id) === String(spot.id);
            }
        );
    };

    if (!isShown()) {
        currentSpots = filterSpots();
        if (!isShown()) {
            currentSpots = currentSpots.concat([spot]);
        }
        drawMarkers(currentSpots);
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
        // 詳細を開くとピンの位置を合わせ直すので、移動中は余白なしで真ん中へ
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
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

    // 詳細を開いている間は、ほかのピンを少し薄くして、見ているピンを目立たせる（style.css）
    map.getContainer().classList.toggle(
        "has-selected",
        Boolean(document.querySelector(".mapboxgl-marker.is-selected"))
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

            renderSpotCourses(
                popup.getElement().querySelector(".popup-courses"),
                data.id
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
            // （「近くの聖地」で別の聖地へ移動中の時は、その移動を止めてしまうので戻さない）
            setTimeout(
                function () {
                    if (
                        !document.querySelector(".mapboxgl-popup .popup-card") &&
                        !map.isMoving()
                    ) {
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
// ズームアウトした時のまとめピン
// 画面上で近いピン同士（CLUSTER_RADIUS_PX 以内）を1つにまとめ、
// 作品の色の輪（作品ごとの割合）と件数で表す。押すと、まとめた聖地が見える所まで拡大する
// =========================================================
const CLUSTER_RADIUS_PX = 48;

function getSpotLngLat(spot) {
    const longitude = Number(spot.coord?.longitude);
    const latitude = Number(spot.coord?.latitude);

    return Number.isFinite(longitude) && Number.isFinite(latitude)
        ? [longitude, latitude]
        : null;
}

// 画面上の位置で近いものからまとめる（件数が少ないので、全部の組み合わせを調べる）
function clusterSpots(list) {
    const clusters = [];

    list.forEach(
        function (spot) {
            const lngLat = getSpotLngLat(spot);
            if (!lngLat) {
                return;
            }

            const point = map.project(lngLat);
            const near = clusters.find(
                function (cluster) {
                    return Math.hypot(cluster.x - point.x, cluster.y - point.y) <= CLUSTER_RADIUS_PX;
                }
            );

            if (near) {
                near.spots.push(spot);
                // まとめた中心は、入っている聖地の平均の位置
                near.x += (point.x - near.x) / near.spots.length;
                near.y += (point.y - near.y) / near.spots.length;
            } else {
                clusters.push({ x: point.x, y: point.y, spots: [spot] });
            }
        }
    );

    return clusters.map(
        function (cluster) {
            return cluster.spots;
        }
    );
}

// まとめた聖地の真ん中（緯度・経度の平均）
function getGroupCenter(group) {
    let longitude = 0;
    let latitude = 0;

    group.forEach(
        function (spot) {
            const lngLat = getSpotLngLat(spot);
            longitude += lngLat[0];
            latitude += lngLat[1];
        }
    );

    return [longitude / group.length, latitude / group.length];
}

// 作品の色の輪（作品ごとの件数の割合で区切る）
function getClusterRing(group) {
    const counts = {};
    group.forEach(
        function (spot) {
            const title = getTitleName(spot);
            counts[title] = (counts[title] || 0) + 1;
        }
    );

    const titles = Object.keys(counts).sort(
        function (a, b) {
            return counts[b] - counts[a];
        }
    );

    let start = 0;
    const stops = titles.map(
        function (title) {
            const end = start + counts[title] / group.length * 360;
            const color = titleColorMap[title] || getTitleColor(title);
            const stop = `${color} ${start}deg ${end}deg`;
            start = end;
            return stop;
        }
    );

    return { gradient: `conic-gradient(${stops.join(", ")})`, titles: titles };
}

// まとめた聖地が全部見える所まで拡大する（個別のピンが出るズーム11以上にする）
function zoomToGroup(group) {
    const bounds = new mapboxgl.LngLatBounds();
    group.forEach(
        function (spot) {
            bounds.extend(getSpotLngLat(spot));
        }
    );

    const camera = map.cameraForBounds(bounds, { padding: 80, maxZoom: 15 });
    map.easeTo({
        center: camera ? camera.center : bounds.getCenter(),
        zoom: Math.max(11, camera ? camera.zoom : 11),
        duration: prefersReducedMotion() ? 0 : 700
    });
}

// 押した時・Enter／Space で同じ動きをさせる
function onActivate(element, handler) {
    element.addEventListener("click", handler);
    element.addEventListener(
        "keydown",
        function (event) {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handler();
            }
        }
    );
}

// 2か所以上：作品の色の輪と件数
function createClusterMarker(group) {
    const ring = getClusterRing(group);

    const element = document.createElement("div");
    element.className = "spot-cluster";
    element.setAttribute("role", "button");
    element.tabIndex = 0;

    // 件数が多いほど少し大きく（32〜52px）
    const size = Math.round(32 + Math.min(20, Math.log2(group.length) * 5));
    element.style.width = size + "px";
    element.style.height = size + "px";
    element.style.background = ring.gradient;

    const count = document.createElement("span");
    count.className = "spot-cluster-count";
    count.textContent = group.length;
    element.appendChild(count);

    const label =
        ring.titles.slice(0, 3).join("・") +
        (ring.titles.length > 3 ? " ほか" : "") +
        `の聖地 ${group.length}か所（押すと拡大）`;
    element.setAttribute("aria-label", label);
    element.title = label;

    onActivate(
        element,
        function () {
            zoomToGroup(group);
        }
    );

    return new mapboxgl.Marker(element)
        .setLngLat(getGroupCenter(group))
        .addTo(map);
}

// 1か所だけ：作品の色の小さな点（押すと拡大して詳細を開く）
function createSingleDotMarker(spot) {
    const lngLat = getSpotLngLat(spot);
    if (!lngLat) {
        return null;
    }

    const title = getTitleName(spot);

    const element = document.createElement("div");
    element.className = "spot-dot";
    element.setAttribute("role", "button");
    element.tabIndex = 0;
    element.style.background = titleColorMap[title] || getTitleColor(title);

    const label = `${spot.spot_name || "無題のスポット"}（${title}）`;
    element.setAttribute("aria-label", label + "（押すと拡大）");
    element.title = label;

    onActivate(
        element,
        function () {
            goToSpot(spot.id);
        }
    );

    return new mapboxgl.Marker(element)
        .setLngLat(lngLat)
        .addTo(map);
}


// =========================================================
// マーカー描画
// =========================================================
// ピンの出し方（ズームによって変わる）と、最後に描いた一覧
// ズームしても出し方も一覧も同じなら、描き直さない（開いている詳細が閉じないように）
function getMarkerMode() {
    const zoom = map.getZoom();
    if (zoom <= 7) return "group3";
    if (zoom <= 10) return "group4";
    return "spots";
}

let drawnMarkerMode = null;
let drawnMarkerList = null;

function drawMarkers(list) {
    drawnMarkerMode = getMarkerMode();
    drawnMarkerList = list;

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
        clusterSpots(list).forEach(
            function (group) {
                const marker =
                    group.length === 1
                        ? createSingleDotMarker(group[0])
                        : createClusterMarker(group);

                if (marker) {
                    spotMarkers.push(marker);
                }
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
            const imageSrc =
                getSpotImageSrc(data.image_url);

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

                    ${imageSrc
                        ? `<div class="popup-image">
                            <img
                                src="${escapeHTML(imageSrc)}"
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

                    <!-- この作品のおすすめルート（開いた時に作る） -->
                    <div class="popup-section popup-courses" data-spot-id="${escapeHTML(String(data.id))}" hidden></div>

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

        // 1か所ずつのピンを出している間は、ズームしてもピンは同じなので描き直さない
        // （描き直すと、開いている詳細が閉じて、どのピンを見ていたか分からなくなる）
        if (
            getMarkerMode() === "spots" &&
            drawnMarkerMode === "spots" &&
            drawnMarkerList === currentSpots
        ) {
            return;
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
        // 検索バー表示（聖地の読み込みを待たずに出す。聖地の候補は読み込めた分から出る）
        try {
            initializeSearchBox();
        } catch (error) {
            console.error(
                "検索バーの表示に失敗:",
                error
            );
        }


        // 前回の聖地があれば、すぐにピンを出す
        if (cachedSpots) {
            try {
                applyActiveFilter();
            } catch (error) {
                console.error(
                    "ピンの描画に失敗:",
                    error
                );
            }
        }


        // 最新の聖地を待つ（遅い時はお知らせする）
        const slowTimer =
            setTimeout(
                function () {
                    window.showToast(
                        "聖地を読み込んでいます…"
                    );
                },
                cachedSpots ? 15000 : 3000
            );

        try {
            const latest =
                await latestSpotsPromise;

            setSpots(latest);
            writeSpotCache(latest);
        } catch (error) {
            console.error(
                "データの読み込みに失敗:",
                error
            );

            if (!cachedSpots) {
                window.showToast(
                    "聖地を読み込めませんでした。通信状況を確認して、ページを開き直してください",
                    "error"
                );
            }
        }

        clearTimeout(slowTimer);


        // ピン描画（絞り込み中ならそれに合わせる）
        try {
            applyActiveFilter();
        } catch (error) {
            console.error(
                "ピンの描画に失敗:",
                error
            );
        }


        // ログインしていればお気に入りを読み込む（待たずに進める）
        loadFavoriteIds();

        // おすすめルートを読み込む（待たずに進める）
        loadCourses();

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
// Googleマップへ渡す＋ルート情報をローカルに保存
// =========================================================
window.openGoogleMapsRoute = function () {

    if (selectedSpots.length === 0) {
        window.showToast(
            "行きたい場所を追加してください",
            "error"
        );

        return;
    }

    const locations = selectedSpots.map(
        function (spot) {
            return `${spot.latitude},${spot.longitude}`;
        }
    );

    const destination =
        locations[locations.length - 1];

    const waypoints = locations
        .slice(0, -1)
        .join("|");

    let url =
        "https://www.google.com/maps/dir/?" +
        "api=1" +
        `&destination=${encodeURIComponent(destination)}`;

    if (waypoints) {
        url +=
            `&waypoints=${encodeURIComponent(waypoints)}`;
    }

    url += "&travelmode=walking";


    // =====================================================
    // ルート情報をローカルに保存
    // =====================================================
    const routeData = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,

        // 保存日時
        savedAt: new Date().toISOString(),

        // 選択したスポット情報
        spots: selectedSpots.map(
            function (spot) {
                return { ...spot };
            }
        ),

        // 目的地・経由地
        destination: destination,
        waypoints: locations.slice(0, -1),

        // 移動方法
        travelMode: "walking",

        // GoogleマップのURL
        googleMapsUrl: url
    };

    try {
        const history = JSON.parse(
            localStorage.getItem("googleMapsRouteHistory") || "[]"
        );

        // 新しい履歴を先頭に追加
        const updatedHistory = Array.isArray(history)
            ? history
            : [];

        updatedHistory.unshift(routeData);

        // 増えすぎないよう、新しいものから50件までにする
        localStorage.setItem(
            "googleMapsRouteHistory",
            JSON.stringify(updatedHistory.slice(0, 50))
        );

    } catch (error) {
        console.error(
            "ルート履歴の保存に失敗しました",
            error
        );
    }


    // =====================================================
    // Googleマップを開く
    // =====================================================
    window.open(url, "_blank");
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
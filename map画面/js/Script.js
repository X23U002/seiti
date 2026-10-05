// =========================================================
// 1. Firebase の読み込みと設定
// =========================================================
import {
    initializeApp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";

import {
    getAnalytics
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-analytics.js";

import {
    getFirestore,
    collection,
    getDocs
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCga1yFbLWdLXmMrNwScXuOGUWnz283eYs",
    authDomain: "sisukai-121cf.firebaseapp.com",
    projectId: "sisukai-121cf",
    storageBucket: "sisukai-121cf.firebasestorage.app",
    messagingSenderId: "83286825212",
    appId: "1:83286825212:web:1cd57aecfb2308571a5f79",
    measurementId: "G-GKWJ6BE9M2"
};

const app = initializeApp(firebaseConfig);

getAnalytics(app);

const db = getFirestore(app);


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
let marker = null;
let hoverPopup = null;

const colors = [
    "#E53935",
    "#1E88E5",
    "#43A047",
    "#FB8C00",
    "#8E24AA",
    "#FDD835",
    "#00897B",
    "#6D4C41",
    "#EC407A",
    "#5E35B1"
];

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
            /[  ・！!？\?△○〇\-ー]/g,
            ""
        );
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
function getTitleName(data) {
    return data.title_name || "";
}


async function loadData() {
    const spotSnapshot =
        await getDocs(
            collection(
                db,
                "spot"
            )
        );

    spots = [];

    let colorIndex = 0;

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

            if (
                !titleColorMap[
                    titleName
                ]
            ) {
                titleColorMap[
                    titleName
                ] =
                    colors[
                        colorIndex %
                        colors.length
                    ];

                colorIndex++;
            }

            spots.push({
                id: docSnap.id,
                ...data
            });
        }
    );

    currentSpots = spots;

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

            const imagePath =
                data.image_url ===
                    "not_image" ||
                !data.image_url

                    ? "17dcbe459a812a827a0092ed44d9808f_t.jpeg"

                    : data.image_url;

            const titleColor =
                titleColorMap[
                    titleName
                ] ||
                "#0b3c5d";

            const titleURL =
                data.title_url;


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
            const popupHTML = `
                <div class="popup-card">

                    <div
                        class="popup-title"
                        style="background:${titleColor};"
                    >
                        ${escapeHTML(titleName)}
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

                    <div class="popup-image">
                        <img
                            src="${escapeHTML(imagePath)}"
                            alt="スポット画像"
                        >
                    </div>

                    <!-- スタンプ取得ボタン -->
                    ${stampHTML}

                    <div class="popup-buttons">

                        <a
                            href="${titleURL || "#"}"
                            target="_blank"
                            class="popup-home"
                        >
                            🌐
                        </a>

                        <button
                            type="button"
                            onclick="addSpotToRouteById('${data.id}')"
                        >
                            📍ルートに追加
                        </button>

                    </div>

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
                        new mapboxgl.Popup({
                            offset: 25
                        }).setHTML(
                            popupHTML
                        )
                    )
                    .addTo(map);


            // stampsyori.jsがマーカーを判別するために必要
            spotMarker
                .getElement()
                .dataset
                .spotId =
                    String(data.id);


            if (
                typeof window
                    .isSpotStamped ===
                    "function" &&
                window.isSpotStamped(
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
                false
        });

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

                    setTimeout(
                        function () {
                            if (
                                spotMarkers
                                    .length > 0
                            ) {
                                spotMarkers[0]
                                    .togglePopup();
                            }
                        },
                        500
                    );
                }
            } else {
                currentSpots =
                    spots;

                drawMarkers(
                    currentSpots
                );
            }
        }
    );


    geocoder.on(
        "clear",
        function () {
            currentSpots =
                spots;

            drawMarkers(
                currentSpots
            );
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


        // 現在地取得
        try {
            geolocate.trigger();
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
let pressTimer;

const canvas =
    map.getCanvas();


// スマホ長押し
canvas.addEventListener(
    "touchstart",
    function (event) {
        pressTimer =
            setTimeout(
                function () {
                    const touch =
                        event.touches[0];

                    const rect =
                        canvas
                            .getBoundingClientRect();

                    const lngLat =
                        map.unproject([
                            touch.clientX -
                                rect.left,

                            touch.clientY -
                                rect.top
                        ]);

                    if (marker) {
                        marker.remove();
                    }

                    marker =
                        new mapboxgl.Marker({
                            draggable: true
                        })
                            .setLngLat(
                                lngLat
                            )
                            .addTo(map);
                },
                600
            );
    }
);


canvas.addEventListener(
    "touchend",
    function () {
        clearTimeout(
            pressTimer
        );
    }
);


canvas.addEventListener(
    "touchmove",
    function () {
        clearTimeout(
            pressTimer
        );
    }
);


map.on(
    "contextmenu",
    function () {
        if (marker) {
            marker.remove();
            marker = null;
        }
    }
);


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

        if (!is3D) {
            map.touchPitch.enable();

            map.easeTo({
                pitch: 70,
                bearing: -20,
                duration: 1500
            });

            button.innerHTML =
                "🔄 2D";

            button.classList.add(
                "mode3d"
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

            button.innerHTML =
                "🔄 3D";

            button.classList.remove(
                "mode3d"
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
function populateAnimeList() {
    const availableTitles =
        Object.keys(
            titleColorMap
        );

    const listContainer =
        document.getElementById(
            "anime-list"
        );

    if (!listContainer) {
        return;
    }

    listContainer.innerHTML = "";

    availableTitles.forEach(
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

            checkbox.type =
                "checkbox";

            checkbox.value =
                title;

            label.appendChild(
                checkbox
            );

            label.appendChild(
                document.createTextNode(
                    title
                )
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

        searchInput.value = "";

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

        const checkboxes =
            document.querySelectorAll(
                "#anime-list input[type='checkbox']"
            );

        checkboxes.forEach(
            function (checkbox) {
                checkbox.checked =
                    false;
            }
        );

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
// 作品検索
// =========================================================
window.searchAnime =
    function () {
        const keyword =
            normalizeText(
                document
                    .getElementById(
                        "anime-search"
                    )
                    .value
            );

        const labels =
            document.querySelectorAll(
                "#anime-list label"
            );

        labels.forEach(
            function (label) {
                const title =
                    normalizeText(
                        label.textContent
                    );

                label.style.display =
                    title.includes(
                        keyword
                    )
                        ? "block"
                        : "none";
            }
        );
    };


// =========================================================
// 絞り込み適用
// =========================================================
window.applyFilter =
    function () {
        const rawKeyword =
            document
                .getElementById(
                    "anime-search"
                )
                .value
                .trim();

        const keyword =
            normalizeText(
                rawKeyword
            );

        const checkedBoxes =
            document.querySelectorAll(
                "#anime-list input[type='checkbox']:checked"
            );

        const selectedTitles =
            Array.from(
                checkedBoxes
            ).map(
                function (checkbox) {
                    return checkbox.value;
                }
            );

        if (
            rawKeyword === "" &&
            selectedTitles.length === 0
        ) {
            currentSpots =
                spots;

            drawMarkers(
                currentSpots
            );

            window.closeFilter();

            return;
        }

        const filteredSpots =
            spots.filter(
                function (spot) {
                    const rawTitle =
                        getTitleName(
                            spot
                        );

                    const title =
                        normalizeText(
                            rawTitle
                        );

                    const isMatchKeyword =
                        keyword !== "" &&
                        title.includes(
                            keyword
                        );

                    const isMatchCheck =
                        selectedTitles.includes(
                            rawTitle
                        );

                    return (
                        isMatchKeyword ||
                        isMatchCheck
                    );
                }
            );

        if (
            filteredSpots.length > 0
        ) {
            currentSpots =
                filteredSpots;

            drawMarkers(
                currentSpots
            );
        } else {
            alert(
                "入力された作品名のスポットは見つかりませんでした。"
            );

            currentSpots =
                spots;

            drawMarkers(
                currentSpots
            );
        }

        window.closeFilter();
    };


// =========================================================
// 絞り込みリセット
// =========================================================
window.resetFilter =
    function () {
        const searchInput =
            document.getElementById(
                "anime-search"
            );

        if (searchInput) {
            searchInput.value = "";
        }

        const checkboxes =
            document.querySelectorAll(
                "#anime-list input[type='checkbox']"
            );

        checkboxes.forEach(
            function (checkbox) {
                checkbox.checked =
                    false;
            }
        );

        currentSpots =
            spots;

        drawMarkers(
            currentSpots
        );
    };


// =========================================================
// 7. 経路案内
// =========================================================
const selectedSpots = [];

window.selectedSpots =
    selectedSpots;


// IDを使ってルートへ追加
window.addSpotToRouteById =
    function (spotId) {
        const spot =
            spots.find(
                function (item) {
                    return (
                        item.id ===
                        spotId
                    );
                }
            );

        if (
            !spot ||
            !spot.coord
        ) {
            alert(
                "スポットデータが見つかりません。"
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
            alert(
                "この場所はすでに追加されています"
            );

            return;
        }

        selectedSpots.push({
            id:
                spot.id,

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

    if (
        selectedSpots.length === 0
    ) {
        routeList.innerHTML =
            "<p>行きたい場所はありません</p>";

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

            const nameSpan =
                document.createElement(
                    "span"
                );

            nameSpan.textContent =
                `${index + 1}. ${spot.name}`;

            const removeButton =
                document.createElement(
                    "button"
                );

            removeButton.type =
                "button";

            removeButton.textContent =
                "×";

            removeButton.onclick =
                function () {
                    window.removeSpotFromRoute(
                        spot.id
                    );
                };

            routeItem.appendChild(
                nameSpan
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


// =========================================================
// Googleマップへ渡す
// =========================================================
window.openGoogleMapsRoute =
    function () {
        if (
            selectedSpots.length === 0
        ) {
            alert(
                "行きたい場所を追加してください"
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
setTimeout(
    function () {
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
    },
    500
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
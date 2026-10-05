// ==========================================
// stampsyori.js
// 位置情報スタンプ取得
// localStorage + Firestore
// ==========================================

const STAMP_FIREBASE_CONFIG = {
    apiKey: "AIzaSyCga1yFbLWdLXmMrNwScXuOGUWnz283eYs",
    authDomain: "sisukai-121cf.firebaseapp.com",
    projectId: "sisukai-121cf",
    storageBucket: "sisukai-121cf.firebasestorage.app",
    messagingSenderId: "83286825212",
    appId: "1:83286825212:web:1cd57aecfb2308571a5f79",
    measurementId: "G-GKWJ6BE9M2"
};

const STAMP_COLLECTION_NAME = "stampUsers";

// stamp_radiusがない場合の取得半径
const DEFAULT_STAMP_RADIUS_METERS = 50;

// 許容するGPS誤差
const MAX_STAMP_ACCURACY_METERS = 100;

// true：15秒
// false：24時間
const STAMP_DEBUG_MODE = true;

const DEBUG_STAMP_COOLDOWN_MS =
    15 * 1000;

const NORMAL_STAMP_COOLDOWN_MS =
    24 * 60 * 60 * 1000;

const STAMP_HISTORY_STORAGE_KEY =
    "osikatumap-stamp-history-v2";

const LEGACY_STAMP_STORAGE_KEY =
    "osikatumap-stamped-spot-ids-v1";

let currentStampPosition = null;
let stampDb = null;
let stampUserDocument = null;
let stampAuthPromise = null;
let geolocateListenersAttached = false;

const stampHistory =
    loadLocalStampHistory();

window.stampHistory =
    stampHistory;


// ==========================================
// Script.jsからスポット一覧を取得
// ==========================================
function getStampSpots() {
    return Array.isArray(
        window.spots
    )
        ? window.spots
        : [];
}


// ==========================================
// オフラインテスト判定
// ==========================================
function isOfflineStampMode() {
    return (
        window.OFFLINE_TEST_MODE ===
        true
    );
}


// ==========================================
// 現在の待ち時間
// ==========================================
function getStampCooldownMs() {
    return STAMP_DEBUG_MODE
        ? DEBUG_STAMP_COOLDOWN_MS
        : NORMAL_STAMP_COOLDOWN_MS;
}


// ==========================================
// localStorageから履歴を取得
// ==========================================
function loadLocalStampHistory() {
    try {
        const saved =
            localStorage.getItem(
                STAMP_HISTORY_STORAGE_KEY
            );

        if (saved) {
            const parsed =
                JSON.parse(saved);

            if (
                parsed &&
                typeof parsed ===
                    "object" &&
                !Array.isArray(parsed)
            ) {
                return parsed;
            }
        }

        // 古いID配列形式から移行
        const legacySaved =
            localStorage.getItem(
                LEGACY_STAMP_STORAGE_KEY
            );

        if (!legacySaved) {
            return {};
        }

        const legacyIds =
            JSON.parse(
                legacySaved
            );

        if (
            !Array.isArray(
                legacyIds
            )
        ) {
            return {};
        }

        const migratedHistory = {};
        const migratedAt =
            Date.now();

        legacyIds.forEach(
            function (spotId) {
                migratedHistory[
                    String(spotId)
                ] = migratedAt;
            }
        );

        return migratedHistory;
    } catch (error) {
        console.warn(
            "スタンプ履歴の読込に失敗しました:",
            error
        );

        return {};
    }
}


// ==========================================
// localStorageへ保存
// ==========================================
function saveLocalStampHistory() {
    try {
        localStorage.setItem(
            STAMP_HISTORY_STORAGE_KEY,

            JSON.stringify(
                stampHistory
            )
        );
    } catch (error) {
        console.error(
            "スタンプ履歴の端末保存に失敗しました:",
            error
        );
    }
}


// ==========================================
// 残り待ち時間
// ==========================================
function getStampRemainingMs(
    spotId
) {
    const lastStampedAt =
        Number(
            stampHistory[
                String(spotId)
            ]
        );

    if (
        !Number.isFinite(
            lastStampedAt
        )
    ) {
        return 0;
    }

    return Math.max(
        0,

        lastStampedAt +
            getStampCooldownMs() -
            Date.now()
    );
}


// ==========================================
// 現在待ち時間中か
// ==========================================
function isSpotStamped(
    spotId
) {
    return (
        getStampRemainingMs(
            spotId
        ) > 0
    );
}


// ==========================================
// 残り時間表示
// ==========================================
function formatRemainingTime(
    milliseconds
) {
    const totalSeconds =
        Math.max(
            0,

            Math.ceil(
                milliseconds /
                1000
            )
        );

    const hours =
        Math.floor(
            totalSeconds /
            3600
        );

    const minutes =
        Math.floor(
            (
                totalSeconds %
                3600
            ) /
            60
        );

    const seconds =
        totalSeconds %
        60;

    if (hours > 0) {
        return (
            `${hours}時間` +
            `${minutes}分`
        );
    }

    if (minutes > 0) {
        return (
            `${minutes}分` +
            `${seconds}秒`
        );
    }

    return `${seconds}秒`;
}


// ==========================================
// スタンプ取得半径
// ==========================================
function getStampRadius(
    spot
) {
    const radius =
        Number(
            spot?.stamp_radius
        );

    if (
        Number.isFinite(radius) &&
        radius > 0
    ) {
        return radius;
    }

    return (
        DEFAULT_STAMP_RADIUS_METERS
    );
}


// ==========================================
// 2地点間の距離
// ==========================================
function calculateDistanceMeters(
    latitude1,
    longitude1,
    latitude2,
    longitude2
) {
    const earthRadius =
        6371000;

    const toRadian =
        function (degree) {
            return (
                degree *
                Math.PI /
                180
            );
        };

    const latitudeDifference =
        toRadian(
            latitude2 -
            latitude1
        );

    const longitudeDifference =
        toRadian(
            longitude2 -
            longitude1
        );

    const value =
        Math.sin(
            latitudeDifference /
            2
        ) ** 2 +

        Math.cos(
            toRadian(
                latitude1
            )
        ) *

        Math.cos(
            toRadian(
                latitude2
            )
        ) *

        Math.sin(
            longitudeDifference /
            2
        ) ** 2;

    return (
        earthRadius *
        2 *
        Math.atan2(
            Math.sqrt(value),
            Math.sqrt(
                1 - value
            )
        )
    );
}


// ==========================================
// 現在地からスポットまでの距離
// ==========================================
function getDistanceToSpot(
    spot
) {
    if (
        !currentStampPosition
    ) {
        return null;
    }

    const latitude =
        Number(
            spot?.coord?.latitude
        );

    const longitude =
        Number(
            spot?.coord?.longitude
        );

    if (
        !Number.isFinite(
            latitude
        ) ||
        !Number.isFinite(
            longitude
        )
    ) {
        return null;
    }

    return calculateDistanceMeters(
        currentStampPosition
            .latitude,

        currentStampPosition
            .longitude,

        latitude,
        longitude
    );
}


// ==========================================
// 距離表示
// ==========================================
function formatStampDistance(
    distance
) {
    if (
        !Number.isFinite(
            distance
        )
    ) {
        return "---";
    }

    if (distance < 1000) {
        return (
            `${Math.round(
                distance
            )}m`
        );
    }

    return (
        `${(
            distance /
            1000
        ).toFixed(1)}km`
    );
}


// ==========================================
// ボタン状態
// ==========================================
function getStampState(
    spot
) {
    const remainingMs =
        getStampRemainingMs(
            spot.id
        );

    // 待ち時間中
    if (remainingMs > 0) {
        const remainingText =
            formatRemainingTime(
                remainingMs
            );

        return {
            disabled: true,

            label:
                `⏳ あと${remainingText}`,

            message:
                `${remainingText}後にもう一度取得できます`
        };
    }

    const radius =
        getStampRadius(
            spot
        );

    // 現在地未取得
    if (
        !currentStampPosition
    ) {
        return {
            disabled: true,

            label:
                "📍 現在地を取得してください",

            message:
                `半径${radius}m以内で取得できます`
        };
    }

    const distance =
        getDistanceToSpot(
            spot
        );

    // GPS精度が低い
    if (
        currentStampPosition
            .accuracy >
        MAX_STAMP_ACCURACY_METERS
    ) {
        return {
            disabled: true,

            label:
                "現在地から離れています。",

            message:
                `GPS誤差 ±${Math.round(
                    currentStampPosition
                        .accuracy
                )}m`
        };
    }

    // 取得可能
    if (
        Number.isFinite(
            distance
        ) &&
        distance <= radius
    ) {
        return {
            disabled: false,

            label:
                "🎫 スタンプを取得",

            message:
                `スポットまで${formatStampDistance(
                    distance
                )}・取得可能`
        };
    }

    // 範囲外
    const remainingDistance =
        Number.isFinite(
            distance
        )
            ? Math.max(
                0,

                distance -
                radius
            )
            : null;

    return {
        disabled: true,

        label:
            Number.isFinite(
                remainingDistance
            )
                ? `あと${formatStampDistance(
                    remainingDistance
                )}`
                : "現在地を確認できません",

        message:
            Number.isFinite(
                distance
            )
                ? `スポットまで${formatStampDistance(
                    distance
                )}・半径${radius}m以内で取得できます`
                : "スポットの座標を確認できません"
    };
}


// ==========================================
// HTMLエスケープ
// ==========================================
function escapeStampHTML(
    value
) {
    return String(
        value ?? ""
    )
        .replaceAll(
            "&",
            "&amp;"
        )
        .replaceAll(
            "<",
            "&lt;"
        )
        .replaceAll(
            ">",
            "&gt;"
        )
        .replaceAll(
            '"',
            "&quot;"
        )
        .replaceAll(
            "'",
            "&#039;"
        );
}


// ==========================================
// ポップアップへ渡すHTML
// ==========================================
function getStampPopupHTML(
    spot
) {
    const state =
        getStampState(
            spot
        );

    const spotId =
        escapeStampHTML(
            spot.id
        );

    return `
        <div
            class="stamp-popup-area"
            style="margin-top:12px;"
        >
            <p
                class="stamp-distance-message"
                data-stamp-message-id="${spotId}"
                style="
                    margin:0 0 8px;
                    font-size:13px;
                    color:#444;
                "
            >${escapeStampHTML(
                state.message
            )}</p>

            <button
                type="button"
                class="stamp-button"
                data-stamp-action="collect"
                data-stamp-spot-id="${spotId}"
                ${
                    state.disabled
                        ? "disabled"
                        : ""
                }
                style="
                    width:100%;
                    min-height:44px;
                    padding:10px 12px;
                    border:0;
                    border-radius:10px;
                    background:#f59e0b;
                    color:#fff;
                    font-size:15px;
                    font-weight:bold;
                    opacity:${
                        state.disabled
                            ? "0.55"
                            : "1"
                    };
                    cursor:${
                        state.disabled
                            ? "not-allowed"
                            : "pointer"
                    };
                "
            >${escapeStampHTML(
                state.label
            )}</button>
        </div>
    `;
}


// ==========================================
// Firestore保存用データ
// ==========================================
function createFirestoreStampHistory() {
    return Object
        .entries(
            stampHistory
        )
        .map(
            function (
                [
                    spotId,
                    stampedAt
                ]
            ) {
                return {
                    spotId:
                        String(
                            spotId
                        ),

                    stampedAt:
                        Number(
                            stampedAt
                        )
                };
            }
        );
}


// ==========================================
// Firebase準備
// ==========================================
function prepareStampFirebase() {
    if (
        typeof window.firebase ===
        "undefined"
    ) {
        throw new Error(
            "Firebase compatが読み込まれていません"
        );
    }

    if (
        !window.firebase.apps ||
        window.firebase.apps
            .length === 0
    ) {
        window.firebase
            .initializeApp(
                STAMP_FIREBASE_CONFIG
            );
    }

    stampDb =
        window.firebase
            .firestore();
}


// ==========================================
// Firestore書き込み
// ==========================================
async function writeStampHistoryToFirestore() {
    if (
        !stampUserDocument
    ) {
        throw new Error(
            "Firestoreの保存先がありません"
        );
    }

    await stampUserDocument.set(
        {
            stampHistory:
                createFirestoreStampHistory(),

            updatedAt:
                window.firebase
                    .firestore
                    .FieldValue
                    .serverTimestamp()
        },

        {
            merge: true
        }
    );
}


// ==========================================
// Firebase匿名ログイン・履歴同期
// ==========================================
async function initializeStampStorage() {
    if (
        isOfflineStampMode()
    ) {
        console.log(
            "スタンプ：オフラインテストモード"
        );

        saveLocalStampHistory();
        refreshStampUI();

        return false;
    }

    try {
        prepareStampFirebase();

        const auth =
            window.firebase
                .auth();

        await auth.setPersistence(
            window.firebase
                .auth
                .Auth
                .Persistence
                .LOCAL
        );

        let user =
            await new Promise(
                function (
                    resolve,
                    reject
                ) {
                    const unsubscribe =
                        auth
                            .onAuthStateChanged(
                                function (
                                    currentUser
                                ) {
                                    unsubscribe();

                                    resolve(
                                        currentUser
                                    );
                                },

                                reject
                            );
                }
            );

        if (!user) {
            const result =
                await auth
                    .signInAnonymously();

            user =
                result.user;
        }

        stampUserDocument =
            stampDb
                .collection(
                    STAMP_COLLECTION_NAME
                )
                .doc(
                    user.uid
                );

        // 起動時にFirestoreを1回読む
        const snapshot =
            await stampUserDocument
                .get();

        const data =
            snapshot.exists
                ? snapshot.data()
                : {};

        const serverHistory =
            Array.isArray(
                data.stampHistory
            )
                ? data.stampHistory
                : [];

        let needsSync = false;

        // Firestoreの履歴を端末へ統合
        serverHistory.forEach(
            function (item) {
                const spotId =
                    String(
                        item?.spotId ??
                        ""
                    );

                const stampedAt =
                    Number(
                        item?.stampedAt
                    );

                if (
                    spotId &&
                    Number.isFinite(
                        stampedAt
                    ) &&
                    stampedAt >
                        Number(
                            stampHistory[
                                spotId
                            ] ||
                            0
                        )
                ) {
                    stampHistory[
                        spotId
                    ] = stampedAt;
                }
            }
        );

        // 端末側が新しいか確認
        Object.entries(
            stampHistory
        ).forEach(
            function (
                [
                    spotId,
                    stampedAt
                ]
            ) {
                const serverItem =
                    serverHistory.find(
                        function (item) {
                            return (
                                String(
                                    item?.spotId
                                ) ===
                                String(
                                    spotId
                                )
                            );
                        }
                    );

                if (
                    !serverItem ||
                    Number(
                        stampedAt
                    ) >
                    Number(
                        serverItem
                            .stampedAt ||
                        0
                    )
                ) {
                    needsSync = true;
                }
            }
        );

        saveLocalStampHistory();

        if (needsSync) {
            await writeStampHistoryToFirestore();
        }

        console.log(
            "スタンプ：Firestore同期完了"
        );

        refreshStampUI();

        return true;
    } catch (error) {
        console.error(
            "スタンプのFirestore同期に失敗しました:",
            error
        );

        refreshStampUI();

        return false;
    }
}


// ==========================================
// Firestore保存
// ==========================================
async function saveStampHistoryToFirestore() {
    if (
        isOfflineStampMode()
    ) {
        return;
    }

    if (stampAuthPromise) {
        await stampAuthPromise;
    }

    if (
        !stampUserDocument
    ) {
        throw new Error(
            "Firestoreの保存先を準備できませんでした"
        );
    }

    await writeStampHistoryToFirestore();
}


// ==========================================
// スタンプ取得
// ==========================================
async function collectStamp(spotId) {
    const selectedSpot =
        getStampSpots()
            .find(
                function (spot) {
                    return (
                        String(
                            spot.id
                        ) ===
                        String(
                            spotId
                        )
                    );
                }
            );

    if (!selectedSpot) {
        alert(
            "スポット情報が見つかりません"
        );

        return;
    }

    const state =
        getStampState(
            selectedSpot
        );

    if (
        state.disabled
    ) {
        alert(
            state.message
        );

        return;
    }

    // 通信より先に端末へ保存
    stampHistory[
        String(
            selectedSpot.id
        )
    ] = Date.now();

    saveLocalStampHistory();
    refreshStampUI();
// 獲得スタンプ画面(stamp.html)用に詳細データを保存
        const savedStamps = JSON.parse(localStorage.getItem("collectedStamps")) || [];
        
        // まだ同じスポットが保存されていなければ追加する
        if (!savedStamps.some(s => s.id === selectedSpot.id)) {
            // 今日の日付を作成 (例: 2026年05月15日)
            const now = new Date();
            const dateString = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月${String(now.getDate()).padStart(2, '0')}日`;
            
            savedStamps.push({
                id: selectedSpot.id,
                name: selectedSpot.spot_name || selectedSpot.title_name || "無題のスポット",
                date: dateString,
                anime: selectedSpot.title_name || "作品名不明",
                scene: selectedSpot.scene || selectedSpot.spot_info || "情報がありません",
                address: selectedSpot.address || "住所未登録" // 住所データがあれば表示
            });
            localStorage.setItem("collectedStamps", JSON.stringify(savedStamps));
        }
    const nextText =
        STAMP_DEBUG_MODE
            ? "15秒後に再取得できます"
            : "24時間後に再取得できます";

    try {
        await saveStampHistoryToFirestore();

        alert(
            `${
                selectedSpot
                    .spot_name ||
                "スポット"
            }のスタンプを取得しました！\n${nextText}`
        );
    } catch (error) {
        console.error(
            "Firestoreへのスタンプ保存に失敗しました:",
            error
        );

        alert(
            `${
                selectedSpot
                    .spot_name ||
                "スポット"
            }のスタンプを端末に保存しました。\nFirestoreへの保存には失敗しました。\n${nextText}`
        );
    }
}


// ==========================================
// 現在地更新
// ==========================================
function updateStampPosition(
    event
) {
    const coords =
        event?.coords ||
        event?.detail?.coords;

    const latitude =
        Number(
            coords?.latitude
        );

    const longitude =
        Number(
            coords?.longitude
        );

    const accuracy =
        Number(
            coords?.accuracy
        );

    if (
        !Number.isFinite(
            latitude
        ) ||
        !Number.isFinite(
            longitude
        )
    ) {
        return;
    }

    currentStampPosition = {
        latitude:
            latitude,

        longitude:
            longitude,

        accuracy:
            Number.isFinite(
                accuracy
            )
                ? accuracy
                : 0
    };

    refreshStampUI();
}


// ==========================================
// Mapboxの位置情報イベント接続
// ==========================================
function attachStampGeolocateListeners() {
    if (
        geolocateListenersAttached
    ) {
        return true;
    }

    const stampGeolocate =
        window.geolocate;

    if (
        !stampGeolocate ||
        typeof stampGeolocate.on !==
            "function"
    ) {
        return false;
    }

    stampGeolocate.on(
        "geolocate",
        updateStampPosition
    );

    stampGeolocate.on(
        "error",

        function (error) {
            console.error(
                "位置情報を取得できません:",
                error
            );
        }
    );

    geolocateListenersAttached =
        true;

    return true;
}


// ==========================================
// ボタン・メッセージ更新
// ==========================================
function refreshStampUI() {
    const spots =
        getStampSpots();

    document
        .querySelectorAll(
            '[data-stamp-action="collect"]'
        )
        .forEach(
            function (button) {
                const spot =
                    spots.find(
                        function (item) {
                            return (
                                String(
                                    item.id
                                ) ===
                                String(
                                    button
                                        .dataset
                                        .stampSpotId
                                )
                            );
                        }
                    );

                if (!spot) {
                    return;
                }

                const state =
                    getStampState(
                        spot
                    );

                button.disabled =
                    state.disabled;

                button.textContent =
                    state.label;

                button.style.opacity =
                    state.disabled
                        ? "0.55"
                        : "1";

                button.style.cursor =
                    state.disabled
                        ? "not-allowed"
                        : "pointer";

                document
                    .querySelectorAll(
                        "[data-stamp-message-id]"
                    )
                    .forEach(
                        function (
                            message
                        ) {
                            if (
                                String(
                                    message
                                        .dataset
                                        .stampMessageId
                                ) ===
                                String(
                                    spot.id
                                )
                            ) {
                                message
                                    .textContent =
                                        state.message;
                            }
                        }
                    );
            }
        );

    document
        .querySelectorAll(
            ".mapboxgl-marker[data-spot-id]"
        )
        .forEach(
            function (
                markerElement
            ) {
                markerElement
                    .classList
                    .toggle(
                        "stamp-completed-marker",

                        isSpotStamped(
                            markerElement
                                .dataset
                                .spotId
                        )
                    );
            }
        );
}


// ==========================================
// 指定スポットを即リセット
// resetStampCooldown("スポットID")
// ==========================================
async function resetStampCooldown(
    spotId
) {
    delete stampHistory[
        String(spotId)
    ];

    saveLocalStampHistory();
    refreshStampUI();

    try {
        await saveStampHistoryToFirestore();
    } catch (error) {
        console.warn(
            "リセットのFirestore同期に失敗しました:",
            error
        );
    }

    console.log(
        `${spotId}を再取得可能にしました`
    );
}


// ==========================================
// 全スポットを即リセット
// resetAllStampCooldowns()
// ==========================================
async function resetAllStampCooldowns() {
    Object.keys(
        stampHistory
    ).forEach(
        function (spotId) {
            delete stampHistory[
                spotId
            ];
        }
    );

    saveLocalStampHistory();
    refreshStampUI();

    try {
        await saveStampHistoryToFirestore();
    } catch (error) {
        console.warn(
            "全リセットのFirestore同期に失敗しました:",
            error
        );
    }

    console.log(
        "全スタンプを再取得可能にしました"
    );
}


// ==========================================
// テスト用現在地
// setStampTestLocation("スポットID", 0)
// ==========================================
function setStampTestLocation(
    spotId,
    distanceMeters = 0
) {
    const spot =
        getStampSpots()
            .find(
                function (item) {
                    return (
                        String(
                            item.id
                        ) ===
                        String(
                            spotId
                        )
                    );
                }
            );

    if (!spot) {
        console.error(
            "スポットが見つかりません:",
            spotId
        );

        return;
    }

    currentStampPosition = {
        latitude:
            Number(
                spot.coord
                    .latitude
            ) +
            Number(
                distanceMeters
            ) /
            111320,

        longitude:
            Number(
                spot.coord
                    .longitude
            ),

        accuracy:
            5
    };

    refreshStampUI();

    console.log(
        `${
            spot.spot_name ||
            spot.id
        }から約${distanceMeters}mの位置に設定しました`
    );
}


// ==========================================
// HTML接続
// ==========================================
document.addEventListener(
    "DOMContentLoaded",

    function () {
        // 動的に作られるスタンプボタン
        document.addEventListener(
            "click",

            function (event) {
                if (
                    !(
                        event.target instanceof
                        Element
                    )
                ) {
                    return;
                }

                const button =
                    event.target.closest(
                        '[data-stamp-action="collect"]'
                    );

                if (!button) {
                    return;
                }

                collectStamp(
                    button
                        .dataset
                        .stampSpotId
                );
            }
        );

        // 本番HTMLの現在地ボタン
        const locationButton =
            document.getElementById(
                "location-btn"
            );

        if (locationButton) {
            locationButton
                .addEventListener(
                    "click",

                    function () {
                        attachStampGeolocateListeners();
                    }
                );
        }

        // Script.jsのGeolocateControlへ接続
        if (
            !attachStampGeolocateListeners()
        ) {
            setTimeout(
                attachStampGeolocateListeners,
                500
            );
        }

        refreshStampUI();

        stampAuthPromise =
            initializeStampStorage();

        setInterval(
            refreshStampUI,

            STAMP_DEBUG_MODE
                ? 1000
                : 60000
        );
    }
);


// ==========================================
// Script.js・コンソールへ公開
// ==========================================
window.getStampPopupHTML =
    getStampPopupHTML;

window.isSpotStamped =
    isSpotStamped;

window.refreshStampUI =
    refreshStampUI;

window.collectStamp =
    collectStamp;

window.updateStampPosition =
    updateStampPosition;

window.setStampTestLocation =
    setStampTestLocation;

window.resetStampCooldown =
    resetStampCooldown;

window.resetAllStampCooldowns =
    resetAllStampCooldowns;
    // ==========================================
// デバッグ：Spaceでマウス位置を現在地にする
// ==========================================
document.addEventListener(
    "keydown",

    function (event) {
        // Space以外は何もしない
        if (
            event.code !==
            "Space"
        ) {
            return;
        }

        // 長押しによる連続実行を防ぐ
        if (event.repeat) {
            return;
        }

        // 検索欄などで文字入力中は実行しない
        if (
            event.target instanceof
                Element &&
            event.target.closest(
                "input, textarea, [contenteditable='true']"
            )
        ) {
            return;
        }

        const mousePosition =
            window
                .debugStampMousePosition;

        if (!mousePosition) {
            console.warn(
                "地図上へマウスを移動してください"
            );

            return;
        }

        // Spaceによる画面スクロールを防止
        event.preventDefault();

        // スタンプ判定用の現在地を変更
        currentStampPosition = {
            latitude:
                mousePosition.latitude,

            longitude:
                mousePosition.longitude,

            // デバッグなのでGPS誤差は5m扱い
            accuracy:
                5
        };

        // ポップアップのスタンプボタンを更新
        refreshStampUI();

        console.log(
            "デバッグ現在地を変更しました:",
            currentStampPosition
        );
    }
);
// ==========================================
// stampsyori.js
// 位置情報スタンプ取得
// 保存先：Firestore の stamp コレクション（スタンプを取るたびに1件追加）
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

// スタンプの保存先
// stamp/{自動ID}：{ user_id: user/{ID}への参照, spot_id: spot/{ID}への参照, time_stamp: 取得日時 }
// ※ Firestoreのルールで「作成」だけが許可されている（更新・削除はできない）
const STAMP_COLLECTION_NAME = "stamp";
const USER_COLLECTION_NAME = "user";
const SPOT_COLLECTION_NAME = "spot";

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

// 以前は端末（localStorage）に保存していた。
// ログイン後に一度だけDBへ移して、端末からは消す
const STAMP_HISTORY_STORAGE_KEY =
    "osikatumap-stamp-history-v2";

const LEGACY_STAMP_STORAGE_KEY =
    "osikatumap-stamped-spot-ids-v1";

const COLLECTED_STAMPS_STORAGE_KEY =
    "collectedStamps";

let currentStampPosition = null;
let stampDb = null;
let stampUserRef = null;
let stampLoadPromise = null;
let geolocateListenersAttached = false;

// DBの読み込み状態
// loading：読み込み中 / ready：読み込み済み / guest：未ログイン / error：読み込み失敗
let stampStorageState = "loading";

// 通信中のスポット（連打で二重に保存しないため）
const collectingSpotIds = new Set();

// スポットID → 最後にスタンプを取った時刻（DBから読み込む）
const stampHistory = {};

// スポットID → 取った回数（DBの stamp の件数）
const stampCounts = {};

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
// 以前に端末へ保存した取得時刻を読む（DBへの移行用）
// ==========================================
function loadLegacyLocalStampHistory() {
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
// 一度でもスタンプを取ったスポットか（地図のピンの ✓ に使う）
// ==========================================
function hasCollectedStamp(
    spotId
) {
    return (
        String(spotId) in
        stampHistory
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
    // ログインしていない
    if (
        stampStorageState ===
        "guest"
    ) {
        return {
            disabled: false,
            label:
                "🔑 ログインしてスタンプを集める",
            message:
                "スタンプはアカウントに保存されます"
        };
    }

    // DBの読み込みが終わっていない・失敗した
    if (
        stampStorageState !==
        "ready"
    ) {
        return {
            disabled: true,
            label:
                stampStorageState ===
                "loading"
                    ? "スタンプ情報を読み込み中…"
                    : "スタンプ情報を読み込めません",
            message:
                stampStorageState ===
                "loading"
                    ? "少しお待ちください"
                    : "通信状況を確認して、地図を開き直してください"
        };
    }

    // 保存中
    if (
        collectingSpotIds.has(
            String(spot.id)
        )
    ) {
        return {
            disabled: true,
            label:
                "保存中…",
            message:
                "スタンプを保存しています"
        };
    }

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
// ログイン中のユーザーID（未ログインなら null）
// ==========================================
function getStampLoginUserId() {
    try {
        return (
            sessionStorage.getItem(
                "userId"
            ) ||
            localStorage.getItem(
                "seitiCurrentUserId"
            ) ||
            null
        );
    } catch (error) {
        return null;
    }
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
// 1件分のスタンプ（stampコレクションのルールに合わせる）
// stampedAt を省くとサーバーの時刻になる
// ==========================================
function createStampDocument(
    spotId,
    stampedAt
) {
    return {
        user_id:
            stampUserRef,
        spot_id:
            stampDb
                .collection(
                    SPOT_COLLECTION_NAME
                )
                .doc(
                    String(spotId)
                ),
        time_stamp:
            stampedAt
                ? window.firebase
                    .firestore
                    .Timestamp
                    .fromMillis(
                        stampedAt
                    )
                : window.firebase
                    .firestore
                    .FieldValue
                    .serverTimestamp()
    };
}


// ==========================================
// 以前に端末へ保存したスタンプをDBへ移す（1回だけ）
// ==========================================
async function migrateLocalStampsToFirestore() {
    let collected = [];

    try {
        collected =
            JSON.parse(
                localStorage.getItem(
                    COLLECTED_STAMPS_STORAGE_KEY
                )
            ) || [];
    } catch (error) {
        collected = [];
    }

    const localHistory =
        loadLegacyLocalStampHistory();

    // スポットID → 端末に残っていた情報
    const localStamps = {};

    collected.forEach(
        function (stamp) {
            if (stamp && stamp.id !== undefined) {
                localStamps[String(stamp.id)] = stamp;
            }
        }
    );

    Object.keys(
        localHistory
    ).forEach(
        function (spotId) {
            localStamps[spotId] =
                localStamps[spotId] || { id: spotId };
        }
    );

    const spotIds =
        Object.keys(
            localStamps
        ).filter(
            function (spotId) {
                // DBに既にあるスポットはそのまま
                return !(spotId in stampHistory);
            }
        );

    if (spotIds.length > 0) {
        const batch =
            stampDb.batch();

        spotIds.forEach(
            function (spotId) {
                const stampedAt =
                    Number(localHistory[spotId]) ||
                    Date.now();

                batch.set(
                    stampDb
                        .collection(
                            STAMP_COLLECTION_NAME
                        )
                        .doc(),
                    createStampDocument(
                        spotId,
                        stampedAt
                    )
                );
            }
        );

        await batch.commit();

        // 保存できてから地図に反映する
        spotIds.forEach(
            function (spotId) {
                stampHistory[spotId] =
                    Number(localHistory[spotId]) ||
                    Date.now();

                stampCounts[spotId] = 1;
            }
        );

        console.log(
            `スタンプ：端末の${spotIds.length}件をDBへ移しました`
        );
    }

    // 移し終わったので端末からは消す
    localStorage.removeItem(STAMP_HISTORY_STORAGE_KEY);
    localStorage.removeItem(LEGACY_STAMP_STORAGE_KEY);
    localStorage.removeItem(COLLECTED_STAMPS_STORAGE_KEY);
}


// ==========================================
// DBからスタンプを読み込む
// ==========================================
async function initializeStampStorage() {
    const userId =
        getStampLoginUserId();

    if (!userId) {
        stampStorageState =
            "guest";

        refreshStampUI();

        return false;
    }

    try {
        prepareStampFirebase();

        stampUserRef =
            stampDb
                .collection(
                    USER_COLLECTION_NAME
                )
                .doc(
                    userId
                );

        // このユーザーのスタンプを全部読み、スポットごとに一番新しい取得時刻を使う
        const snapshot =
            await stampDb
                .collection(
                    STAMP_COLLECTION_NAME
                )
                .where(
                    "user_id",
                    "==",
                    stampUserRef
                )
                .get();

        snapshot.forEach(
            function (stampDoc) {
                const data =
                    stampDoc.data();

                const spotId =
                    data.spot_id &&
                    data.spot_id.id;

                const stampedAt =
                    data.time_stamp &&
                    typeof data.time_stamp.toMillis === "function"
                        ? data.time_stamp.toMillis()
                        : 0;

                if (!spotId) {
                    return;
                }

                stampCounts[spotId] =
                    (stampCounts[spotId] || 0) + 1;

                if (
                    stampedAt >
                    Number(stampHistory[spotId] || 0)
                ) {
                    stampHistory[spotId] =
                        stampedAt;
                }
            }
        );

        stampStorageState =
            "ready";

        try {
            await migrateLocalStampsToFirestore();
        } catch (error) {
            // 移行に失敗しても端末のデータは残っているので、次回また試す
            console.warn(
                "端末のスタンプをDBへ移せませんでした:",
                error
            );
        }

        console.log(
            "スタンプ：DBから読み込み完了"
        );

        refreshStampUI();

        return true;
    } catch (error) {
        console.error(
            "スタンプの読み込みに失敗しました:",
            error
        );

        stampStorageState =
            "error";

        refreshStampUI();

        return false;
    }
}


// ==========================================
// メッセージ表示（toast.jsが無い場合はalert）
// ==========================================
function notifyStamp(
    message,
    type
) {
    if (
        typeof window.showToast ===
        "function"
    ) {
        window.showToast(
            message,
            type
        );
    } else {
        alert(message);
    }
}


// ==========================================
// スタンプ取得
// ==========================================
async function collectStamp(spotId) {
    // 未ログインならログイン画面へ
    if (
        stampStorageState ===
        "guest"
    ) {
        window.location.href =
            "login.html";

        return;
    }

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
        notifyStamp(
            "スポット情報が見つかりません",
            "error"
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
        notifyStamp(
            state.message,
            "error"
        );

        return;
    }

    const key =
        String(
            selectedSpot.id
        );

    const isFirstTime =
        !hasCollectedStamp(key);

    collectingSpotIds.add(key);
    refreshStampUI();

    try {
        // DBに保存できた時だけ「取得した」ことにする
        await stampDb
            .collection(
                STAMP_COLLECTION_NAME
            )
            .add(
                createStampDocument(
                    key
                )
            );

        stampHistory[key] =
            Date.now();

        stampCounts[key] =
            (stampCounts[key] || 0) + 1;

        showStampCelebration(
            selectedSpot,
            stampCounts[key],
            isFirstTime
                ? getCompletedTitle(selectedSpot)
                : null
        );
    } catch (error) {
        console.error(
            "スタンプの保存に失敗しました:",
            error
        );

        notifyStamp(
            error &&
            error.code ===
                "permission-denied"
                ? "スタンプを保存する権限がありません（Firestoreのルールを確認してください）"
                : "スタンプを保存できませんでした。通信状況を確認して、もう一度お試しください",
            "error"
        );
    } finally {
        collectingSpotIds.delete(key);
        refreshStampUI();
    }
}


// ==========================================
// このスタンプでその作品の聖地を全部回ったら、作品名を返す
// ==========================================
function getCompletedTitle(
    spot
) {
    const title =
        spot.title_name;

    if (!title) {
        return null;
    }

    const titleSpots =
        getStampSpots().filter(
            function (item) {
                return item.title_name === title;
            }
        );

    return titleSpots.length > 0 &&
        titleSpots.every(
            function (item) {
                return hasCollectedStamp(item.id);
            }
        )
        ? title
        : null;
}


// ==========================================
// スタンプ獲得の演出（スタンプを押すアニメーション）
// 作品をコンプリートした時はお祝いも出す
// ==========================================
function showStampCelebration(
    spot,
    count,
    completedTitle
) {
    document
        .querySelectorAll(
            ".stamp-celebration"
        )
        .forEach(
            function (old) {
                old.remove();
            }
        );

    const title =
        spot.title_name ||
        "その他";

    const color =
        typeof window.getTitleColor ===
            "function"
            ? window.getTitleColor(title)
            : "#f59e0b";

    const nextText =
        STAMP_DEBUG_MODE
            ? "15秒後に再取得できます"
            : "24時間後に再取得できます";

    // 取った回数のランク（ちょうど上がった時はお知らせする）
    const rank =
        typeof window.getStampRank ===
            "function"
            ? window.getStampRank(count)
            : null;

    const rankUpText =
        rank &&
        count > 1 &&
        rank.min === count
            ? `✨ ${rank.name}にランクアップ！`
            : "";

    const overlay =
        document.createElement(
            "div"
        );

    overlay.className =
        "stamp-celebration" +
        (completedTitle ? " is-complete" : "");

    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "stamp-celebration-title");

    // お祝いの紙吹雪（コンプリートの時だけ）
    const confetti =
        completedTitle
            ? Array.from(
                { length: 18 },
                function (_, index) {
                    return `<span class="confetti" style="left:${(index * 37) % 100}%;animation-delay:${(index % 6) * 0.12}s;background:${["#f59e0b", "#e53935", "#1e88e5", "#43a047", "#ec407a", "#fdd835"][index % 6]};"></span>`;
                }
            ).join("")
            : "";

    overlay.innerHTML = `
        ${confetti}
        <div class="stamp-celebration-card">
            <div class="stamp-celebration-stamp" aria-hidden="true">⛩️</div>
            <p class="stamp-celebration-title" id="stamp-celebration-title">${completedTitle ? "🎉 作品コンプリート！" : "スタンプ獲得！"}</p>
            ${rankUpText ? `<p class="stamp-celebration-rankup rank-pill rank-${rank.key}">${rankUpText}</p>` : ""}
            <p class="stamp-celebration-spot">${escapeStampHTML(spot.spot_name || "スポット")}</p>
            <p class="stamp-celebration-meta">${escapeStampHTML(title)}・${count}回目${rank ? "・" + rank.name : ""}</p>
            ${completedTitle
                ? `<p class="stamp-celebration-complete">「${escapeStampHTML(completedTitle)}」の聖地を<br>すべて回りました！</p>`
                : ""}
            <p class="stamp-celebration-next">${nextText}</p>
            <button type="button" class="stamp-celebration-close">OK</button>
        </div>
    `;

    const previousFocus =
        document.activeElement;

    let closeTimer = null;

    function close() {
        clearTimeout(closeTimer);
        document.removeEventListener("keydown", onKeydown);
        overlay.remove();

        if (
            previousFocus &&
            document.contains(previousFocus)
        ) {
            previousFocus.focus();
        }
    }

    function onKeydown(event) {
        if (event.key === "Escape") {
            close();
        }
    }

    overlay.addEventListener(
        "click",
        function (event) {
            // カード以外（背景）かOKボタンを押したら閉じる
            if (
                event.target === overlay ||
                event.target.closest(".stamp-celebration-close")
            ) {
                close();
            }
        }
    );

    // 中は作品の色、枠は取った回数のランクの色
    const stampElement =
        overlay.querySelector(
            ".stamp-celebration-stamp"
        );

    if (
        typeof window.applyStampRank ===
        "function"
    ) {
        window.applyStampRank(
            stampElement,
            count,
            color
        );
    } else {
        stampElement.style.background =
            color;
    }

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(overlay);
    overlay.querySelector(".stamp-celebration-close").focus();

    // 普段は少しで自動的に閉じる（コンプリートの時はOKを押すまで残す）
    if (!completedTitle) {
        closeTimer =
            setTimeout(
                close,
                4000
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

                        hasCollectedStamp(
                            markerElement
                                .dataset
                                .spotId
                        )
                    );
            }
        );
}


// ==========================================
// 指定スポットを即リセット（テスト用）
// resetStampCooldown("スポットID")
// DBは「作成」しかできないので、開いている地図の中だけ待ち時間を無くす
// ==========================================
function resetStampCooldown(
    spotId
) {
    const key =
        String(spotId);

    if (!(key in stampHistory)) {
        return;
    }

    stampHistory[key] = 0;
    refreshStampUI();

    console.log(
        `${spotId}を再取得可能にしました（地図を開き直すと元に戻ります）`
    );
}


// ==========================================
// 全スポットを即リセット（テスト用）
// resetAllStampCooldowns()
// ==========================================
function resetAllStampCooldowns() {
    Object.keys(
        stampHistory
    ).forEach(
        resetStampCooldown
    );

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

        stampLoadPromise =
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

window.hasCollectedStamp =
    hasCollectedStamp;

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
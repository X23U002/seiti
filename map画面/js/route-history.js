// ==========================================
// 案内履歴（「Googleマップで徒歩案内」を押したルート）
// 地図画面の openGoogleMapsRoute がこの端末（localStorage の googleMapsRouteHistory）に記録したものを表示し、
// 選んだルートでもう一度 Google マップの案内を始められる
// ==========================================

// =========================================================
// 案内開始ボタン
// =========================================================
window.startRoute = function () {

    // 選択中のルートを取得
    const route = window.selectedRouteForNavigation;

    // ルートが選択されていない場合
    if (!route) {
        if (typeof window.showToast === "function") {
            window.showToast(
                "先に過去の巡礼履歴を選択してください",
                "error"
            );
        } else {
            alert("先に過去の巡礼履歴を選択してください");
        }

        return;
    }

    // 保存されているGoogleマップのURLを取得
    if (!route.googleMapsUrl) {
        alert("このルートのGoogleマップ情報がありません");
        return;
    }

    try {
        // 保存したURLを読み込む
        const routeUrl = new URL(route.googleMapsUrl);

        // ナビゲーション開始を要求する
        routeUrl.searchParams.set(
            "dir_action",
            "navigate"
        );

        // Googleマップを開く
        window.open(
            routeUrl.toString(),
            "_blank"
        );

    } catch (error) {
        console.error(
            "ルート案内の開始に失敗しました",
            error
        );

        alert("ルート案内を開始できませんでした");
    }
};

// =========================================================
// ローカルに保存された巡礼履歴を表示
// =========================================================
// =========================================================
// 過去の巡礼履歴を表示
// =========================================================
window.renderRouteHistory = function () {
    const historyList =
        document.getElementById("historyList");

    if (!historyList) return;

    historyList.replaceChildren();

    let history = [];

    try {
        history = JSON.parse(
            localStorage.getItem("googleMapsRouteHistory") || "[]"
        );

        if (!Array.isArray(history)) {
            history = [];
        }
    } catch (error) {
        console.error("履歴の読み込みに失敗しました", error);
    }

    // タブに件数を出す
    const count = document.getElementById("count-guided");
    if (count) count.textContent = history.length;

    if (history.length === 0) {
        const li = document.createElement("li");
        li.className = "history-item";
        li.textContent = "まだ巡礼履歴はありません";
        historyList.appendChild(li);
        return;
    }

    history.forEach(function (route) {
        const li = document.createElement("li");
        li.className = "history-item";
        li.tabIndex = 0;
        li.setAttribute("role", "button");
        li.setAttribute("aria-pressed", "false");

        // ルート名
        const routeElement = document.createElement("div");
        routeElement.className = "history-route";

        const spots = Array.isArray(route.spots)
            ? route.spots
            : [];

        if (spots.length > 0) {
            spots.forEach(function (spot, index) {
                if (index > 0) {
                    const arrow = document.createElement("span");
                    arrow.className = "arrow";
                    arrow.textContent = " → ";
                    routeElement.appendChild(arrow);
                }

                const name = document.createElement("span");
                name.textContent = getHistorySpotName(spot);
                routeElement.appendChild(name);
            });
        } else {
            routeElement.textContent =
                route.destination || "ルート情報なし";
        }

        // 保存日時
        const dateElement = document.createElement("div");
        dateElement.className = "history-date";

        const date = new Date(
            route.savedAt || route.createdAt
        );

        dateElement.textContent =
            Number.isNaN(date.getTime())
                ? "保存日時不明"
                : date.toLocaleString("ja-JP");

        li.append(routeElement, dateElement);

        // 履歴をクリックしたときの処理
        function selectHistory() {
            window.renderCurrentRoute(route);

            historyList
                .querySelectorAll(".history-item.selected")
                .forEach(function (item) {
                    item.classList.remove("selected");
                    item.setAttribute("aria-pressed", "false");
                });

            li.classList.add("selected");
            li.setAttribute("aria-pressed", "true");
        }

        li.addEventListener("click", selectHistory);

        // Enterキー・Spaceキーでも選択可能にする
        li.addEventListener("keydown", function (event) {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                selectHistory();
            }
        });

        historyList.appendChild(li);
    });
};

// =========================================================
// スポット名を取得
// =========================================================
function getHistorySpotName(spot) {
    if (typeof spot === "string") {
        return spot;
    }

    if (!spot || typeof spot !== "object") {
        return "名称不明のスポット";
    }

    return (
        spot.name ||
        spot.spot_name ||
        spot.spotName ||
        spot.title_name ||
        spot.title ||
        spot.placeName ||
        (
            spot.latitude != null &&
            spot.longitude != null
                ? `${spot.latitude}, ${spot.longitude}`
                : "名称不明のスポット"
        )
    );
}

// =========================================================
// 現在のルート欄を更新
// =========================================================
window.renderCurrentRoute = function (route) {

        // 案内開始時に使うルートを保存
    window.selectedRouteForNavigation = route;

    const timeline = document.getElementById(
        "currentRouteTimeline"
    );

    if (!timeline) return;

    timeline.replaceChildren();

    if (!route) {
        const li = document.createElement("li");
        li.className = "timeline-node current";
        li.textContent =
            "ルート未選択：下の履歴から選択してください";

        timeline.appendChild(li);
        return;
    }

    const spots = Array.isArray(route.spots)
        ? route.spots
        : [];

    // 現在地
    const start = document.createElement("li");
    start.className = "timeline-node current";

    const startTitle = document.createElement("div");
    startTitle.className = "timeline-title";
    startTitle.textContent = "現在地";

    const startDetail = document.createElement("div");
    startDetail.className = "timeline-time";
    startDetail.textContent = "出発点";

    start.append(startTitle, startDetail);
    timeline.appendChild(start);

    // 保存されたスポット
    spots.forEach(function (spot, index) {
        const isGoal = index === spots.length - 1;

        const li = document.createElement("li");
        li.className = isGoal
            ? "timeline-node goal"
            : "timeline-node";

        const title = document.createElement("div");
        title.className = "timeline-title";
        title.textContent = getHistorySpotName(spot);

        const detail = document.createElement("div");
        detail.className = "timeline-time";

        const badge = document.createElement("span");
        badge.className = isGoal
            ? "badge badge-goal"
            : "badge";

        badge.textContent = isGoal ? "目的地" : "経由地";

        detail.appendChild(badge);
        li.append(title, detail);
        timeline.appendChild(li);
    });
};


// =========================================================
// ページを開いたときに履歴を表示
// =========================================================
function initializeHistoryPage() {
    window.renderCurrentRoute(null);
    window.renderRouteHistory();
}

if (document.readyState === "loading") {
    document.addEventListener(
        "DOMContentLoaded",
        initializeHistoryPage
    );
} else {
    initializeHistoryPage();
}

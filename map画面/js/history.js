// ==========================================
// お気に入り・保存したルート・巡礼履歴
// お気に入り（favorite）と保存したルート（root）は地図画面で追加する。
// 巡礼履歴は獲得したスタンプ（stamp）から作る
// ==========================================
import { loadStampBook } from "./stamp-db.js";
import { deleteSavedRoute, loadFavorites, loadSavedRoutes, setFavorite } from "./saved-db.js";
import { getSpotEpisodeLabel } from "./episode.js?v=2";
import { getTitleColor } from "./title-colors.js";

// スポットID → { id, name, title, info }
let spotById = {};

function showNotice(icon, text, link) {
    const notice = document.getElementById("saved-notice");
    notice.innerHTML = "";
    const iconEl = document.createElement("div");
    iconEl.className = "empty-state-icon";
    iconEl.textContent = icon;
    const p = document.createElement("p");
    p.textContent = text;
    notice.append(iconEl, p);
    if (link) {
        const a = document.createElement("a");
        a.href = link.href;
        a.className = "btn btn-primary";
        a.textContent = link.text;
        notice.appendChild(a);
    }
    notice.hidden = false;
    document.getElementById("saved-main").hidden = true;
}

function formatDate(millis) {
    if (!millis) return "";
    const d = new Date(millis);
    return d.getFullYear() + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" +
        String(d.getDate()).padStart(2, "0");
}

function mapUrl(name, value) {
    return "map.html?" + name + "=" + encodeURIComponent(value);
}

function el(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

// 作品名の札（作品の色）と、何話の場面かの札
function createBadges(spot) {
    const row = el("div", "saved-badges");
    const title = el("span", "title-chip", spot.title);
    title.style.background = getTitleColor(spot.title);
    row.appendChild(title);

    const episode = getSpotEpisodeLabel({ season: spot.season, episode: spot.episode, spot_info: spot.info });
    if (episode) row.appendChild(el("span", "ep-chip", episode));
    return row;
}

function createLinkButton(text, href, primary) {
    const a = el("a", "btn " + (primary ? "btn-primary" : "btn-secondary") + " saved-btn", text);
    a.href = href;
    return a;
}

function showEmpty(list, text) {
    const item = el("li", "card empty-state");
    item.appendChild(el("p", "", text));
    list.appendChild(item);
}

function setCount(name, count) {
    document.getElementById("count-" + name).textContent = count;
}

// ---------- お気に入り ----------
function renderFavorites(favorites) {
    const list = document.getElementById("favorite-list");
    list.innerHTML = "";

    // 削除された聖地は出さない
    const items = favorites.filter(function (item) { return spotById[item.spotId]; });
    setCount("favorites", items.length);

    if (items.length === 0) {
        showEmpty(list, "まだありません。地図で聖地の詳細を開き、♡を押すと追加されます。");
        return;
    }

    items.forEach(function (item) {
        const spot = spotById[item.spotId];
        const li = el("li", "card saved-item");
        li.appendChild(createBadges(spot));
        li.appendChild(el("h2", "saved-name", spot.name));

        const actions = el("div", "saved-actions");
        actions.appendChild(createLinkButton("地図で見る", mapUrl("spot", spot.id), true));

        const remove = el("button", "btn btn-secondary saved-btn", "お気に入りから外す");
        remove.type = "button";
        remove.addEventListener("click", async function () {
            remove.disabled = true;
            try {
                await setFavorite(spot.id, false);
                favorites.splice(favorites.indexOf(item), 1);
                renderFavorites(favorites);
                window.showToast("「" + spot.name + "」をお気に入りから外しました");
            } catch (error) {
                console.error("お気に入りを外せませんでした:", error);
                window.showToast("お気に入りを外せませんでした", "error");
                remove.disabled = false;
            }
        });
        actions.appendChild(remove);

        li.appendChild(actions);
        list.appendChild(li);
    });
}

// ---------- 保存したルート ----------
function renderRoutes(routes) {
    const list = document.getElementById("route-list");
    list.innerHTML = "";
    setCount("routes", routes.length);

    if (routes.length === 0) {
        showEmpty(list, "まだありません。地図のルート案内で「このルートを保存」を押すと追加されます。");
        return;
    }

    routes.forEach(function (route) {
        const spotIds = route.spotIds.filter(function (id) { return spotById[id]; });
        const li = el("li", "card saved-item");

        const stops = el("ol", "route-stops");
        spotIds.forEach(function (id) {
            stops.appendChild(el("li", "", spotById[id].name));
        });
        li.appendChild(stops);

        const missing = route.spotIds.length - spotIds.length;
        li.appendChild(el("p", "saved-meta",
            spotIds.length + "か所" +
            (missing > 0 ? "（削除された聖地 " + missing + "か所は除く）" : "") +
            (route.savedAt ? "・" + formatDate(route.savedAt) + " 保存" : "")));

        const actions = el("div", "saved-actions");
        if (spotIds.length > 0) {
            actions.appendChild(createLinkButton("地図で開く", mapUrl("route", spotIds.join(",")), true));
        }

        const remove = el("button", "btn btn-secondary saved-btn saved-delete", "削除");
        remove.type = "button";
        remove.addEventListener("click", async function () {
            if (!window.confirm("このルートを削除しますか？")) return;
            remove.disabled = true;
            try {
                await deleteSavedRoute(route.id);
                routes.splice(routes.indexOf(route), 1);
                renderRoutes(routes);
                window.showToast("ルートを削除しました");
            } catch (error) {
                console.error("ルートを削除できませんでした:", error);
                window.showToast("ルートを削除できませんでした", "error");
                remove.disabled = false;
            }
        });
        actions.appendChild(remove);

        li.appendChild(actions);
        list.appendChild(li);
    });
}

// ---------- 巡礼履歴 ----------
const HISTORY_MAX = 30;

function renderHistory(stamps) {
    const list = document.getElementById("history-list");
    list.innerHTML = "";
    setCount("history", stamps.length);

    if (stamps.length === 0) {
        showEmpty(list, "まだありません。聖地でスタンプを取ると、ここに記録されます。");
        return;
    }

    // 新しい順
    stamps
        .slice()
        .sort(function (a, b) { return b.stampedAt - a.stampedAt; })
        .slice(0, HISTORY_MAX)
        .forEach(function (stamp) {
            const li = el("li", "card saved-item");
            li.appendChild(createBadges({ title: stamp.anime, info: stamp.scene, season: stamp.season, episode: stamp.episode }));
            li.appendChild(el("h2", "saved-name", stamp.name));
            li.appendChild(el("p", "saved-meta",
                stamp.date + " 初獲得" + (stamp.count > 1 ? "・" + stamp.count + "回" : "")));

            const actions = el("div", "saved-actions");
            actions.appendChild(createLinkButton("地図で見る", mapUrl("spot", stamp.id), false));
            li.appendChild(actions);
            list.appendChild(li);
        });

    if (stamps.length > HISTORY_MAX) {
        const li = el("li", "saved-more");
        li.appendChild(createLinkButton("スタンプ帳ですべて見る", "stamp.html", false));
        list.appendChild(li);
    }
}

// ---------- タブ ----------
function setupTabs() {
    const tabs = Array.from(document.querySelectorAll(".saved-tab"));

    function select(tab) {
        tabs.forEach(function (other) {
            const selected = other === tab;
            other.setAttribute("aria-selected", String(selected));
            other.tabIndex = selected ? 0 : -1;
            document.getElementById(other.getAttribute("aria-controls")).hidden = !selected;
        });
        try { sessionStorage.setItem("seitiSavedTab", tab.id); } catch (e) { /* 何もしない */ }
    }

    tabs.forEach(function (tab, index) {
        tab.addEventListener("click", function () { select(tab); });
        // 左右キーでタブを移動
        tab.addEventListener("keydown", function (event) {
            const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
            if (!step) return;
            const next = tabs[(index + step + tabs.length) % tabs.length];
            select(next);
            next.focus();
        });
    });

    // 前に見ていたタブを開く
    let saved = null;
    try { saved = sessionStorage.getItem("seitiSavedTab"); } catch (e) { saved = null; }
    select(document.getElementById(saved) || tabs[0]);
}

(async function init() {
    try {
        const [book, favorites, routes] = await Promise.all([
            loadStampBook(),
            loadFavorites(),
            loadSavedRoutes()
        ]);

        if (!book.stamps || !favorites || !routes) {
            showNotice("🔒", "お気に入りや保存したルートは、ログインすると使えます。", { href: "login.html", text: "ログインする" });
            return;
        }

        spotById = {};
        book.summary.spots.forEach(function (spot) { spotById[spot.id] = spot; });

        renderFavorites(favorites);
        renderRoutes(routes);
        renderHistory(book.stamps);
        setupTabs();

        document.getElementById("saved-notice").hidden = true;
        document.getElementById("saved-main").hidden = false;
    } catch (error) {
        console.error("読み込みに失敗しました:", error);
        showNotice("⚠️", "読み込みに失敗しました。時間をおいてもう一度開いてください。");
    }
})();

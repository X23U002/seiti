// ==========================================
// トップページ（index.html）
// ・ログインしている人には「マイページ」を出す（ログイン・新規登録の代わりに）
// ・対応している作品と聖地の数を、データベースから読んで出す（作品の色の札で並べる）
// Firebase の読み込みは重いので、ここでは Firestore の Web API を直接読む（だれでも読める聖地だけ）
// ==========================================
import { getTitleColor, getTitleName, registerTitles } from "./title-colors.js?v=62cd810d";

const SPOT_URL =
    "https://firestore.googleapis.com/v1/projects/sisukai-121cf/databases/(default)/documents/spot" +
    "?pageSize=300&mask.fieldPaths=title_name&mask.fieldPaths=coord";
// 地図の画面が前に読んだ聖地（public-data.js）。読めない時に使う
const SPOT_CACHE_KEY = "seitiSpotCache";

// ---------- ログインしている人 ----------
function showLoggedIn() {
    let account = null;
    try {
        if (localStorage.getItem("seitiCurrentUserId")) {
            account = JSON.parse(localStorage.getItem("seitiAccount") || "null") || {};
        }
    } catch (error) {
        account = null;
    }
    if (!account) {
        return;
    }

    const guest = document.getElementById("hero-guest");
    const member = document.getElementById("hero-member");
    if (!guest || !member) {
        return;
    }
    guest.hidden = true;
    member.hidden = false;
    const name = document.getElementById("hero-member-name");
    if (name && account.nickname) {
        name.textContent = account.nickname + "さん、";
    }
}

// ---------- 対応作品と聖地の数 ----------
async function fetchSpots() {
    const list = [];
    let pageToken = "";
    do {
        const response = await fetch(SPOT_URL + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""));
        if (!response.ok) {
            throw new Error("聖地を読めませんでした: " + response.status);
        }
        const json = await response.json();
        (json.documents || []).forEach(function (document) {
            const fields = document.fields || {};
            // 地図に出ない（場所の無い）聖地は数えない
            if (!fields.coord) {
                return;
            }
            list.push({ title_name: fields.title_name ? fields.title_name.stringValue : "" });
        });
        pageToken = json.nextPageToken || "";
    } while (pageToken);
    return list;
}

// 前にこのページで読んだ作品（次に開いた時にすぐ出して、読み終わった時に下がずれないようにする）
const TOP_CACHE_KEY = "seitiTopWorks";

function readCachedSpots() {
    for (const key of [TOP_CACHE_KEY, SPOT_CACHE_KEY]) {
        try {
            const list = JSON.parse(localStorage.getItem(key) || "null");
            if (Array.isArray(list) && list.length > 0) return list;
        } catch (error) {
            // 読めなければ次を見る
        }
    }
    return null;
}

function saveCachedSpots(spots) {
    try {
        localStorage.setItem(TOP_CACHE_KEY, JSON.stringify(spots));
    } catch (error) {
        // 保存できない環境では何もしない
    }
}

// 読めなかった時：欄は残して、読めなかったことを知らせる
function renderWorksError() {
    const lead = document.getElementById("works-lead");
    const list = document.getElementById("works-list");
    if (!lead || !list) {
        return;
    }
    lead.textContent = "作品の一覧を読み込めませんでした。時間をおいて開き直してください。";
    list.innerHTML = "";
    list.removeAttribute("aria-busy");
    list.removeAttribute("aria-label");
}

function renderWorks(spots) {
    const section = document.getElementById("works");
    const list = document.getElementById("works-list");
    if (!section || !list) {
        return;
    }
    if (spots.length === 0) {
        renderWorksError();
        return;
    }

    const counts = new Map();
    spots.forEach(function (spot) {
        const title = getTitleName(spot);
        counts.set(title, (counts.get(title) || 0) + 1);
    });
    registerTitles(Array.from(counts.keys()));

    // 聖地の多い作品から並べる（「その他」は最後）
    const titles = Array.from(counts.keys()).sort(function (a, b) {
        if (a === "その他") return 1;
        if (b === "その他") return -1;
        return counts.get(b) - counts.get(a) || a.localeCompare(b, "ja");
    });

    document.getElementById("works-count").textContent = titles.filter(function (title) { return title !== "その他"; }).length;
    document.getElementById("spots-count").textContent = spots.length;

    list.innerHTML = "";
    list.removeAttribute("aria-busy");
    list.removeAttribute("aria-label");
    titles.forEach(function (title) {
        const item = document.createElement("li");
        // 押してもどこへも移らない（作品の紹介ページへは飛ばさない）
        const link = document.createElement("span");
        link.className = "work-chip";

        const dot = document.createElement("span");
        dot.className = "work-chip-dot";
        dot.style.background = getTitleColor(title);
        dot.setAttribute("aria-hidden", "true");

        const name = document.createElement("span");
        name.textContent = title;

        const count = document.createElement("span");
        count.className = "work-chip-count";
        count.textContent = counts.get(title) + "か所";

        link.append(dot, name, count);
        item.appendChild(link);
        list.appendChild(item);
    });

}

async function showWorks() {
    // 前に読んだ作品があれば、まずそれを出しておく（読み終わってもほとんどずれない）
    const cached = readCachedSpots();
    if (cached) {
        renderWorks(cached);
    }
    try {
        const spots = await fetchSpots();
        saveCachedSpots(spots);
        renderWorks(spots);
    } catch (error) {
        // 通信できない時は、前に読んだ作品のまま（それも無ければ、作品一覧への入口を出す）
        if (!cached) {
            renderWorksError();
        }
        console.warn("対応作品を読めませんでした:", error);
    }
}

// ---------- スマホで「ホーム画面に追加」の案内（iPhone と Android で書き方を変える） ----------
function showInstallHint() {
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
    document.querySelectorAll("[data-install]").forEach(function (element) {
        element.hidden = element.dataset.install !== (isIOS ? "ios" : "android");
    });
}

showLoggedIn();
showInstallHint();
showWorks();

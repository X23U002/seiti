// ==========================================
// 作品一覧（聖地のある作品と、聖地の数・スタンプの進み具合・おすすめルートの数）
// 作品を押すと作品ページ（work.html?title=作品名）を開く
// ==========================================
import { getTitleColor, getTitleName } from "./title-colors.js";
import { loadCourses, loadMyStampCounts, loadSpots, readCachedSpots } from "./public-data.js";

let works = [];          // { title, color, spots: [...], routeCount }
let stampCounts = null;  // スポットID → 回数（未ログインなら null）

function showNotice(icon, text) {
    const notice = document.getElementById("works-notice");
    notice.innerHTML = "";
    const iconEl = document.createElement("div");
    iconEl.className = "empty-state-icon";
    iconEl.textContent = icon;
    const p = document.createElement("p");
    p.textContent = text;
    notice.append(iconEl, p);
    notice.hidden = false;
}

function buildWorks(spots, courses) {
    const byTitle = {};
    spots.forEach(function (spot) {
        const title = getTitleName(spot);
        (byTitle[title] = byTitle[title] || []).push(spot);
    });

    works = Object.keys(byTitle).map(function (title) {
        return {
            title: title,
            color: getTitleColor(title),
            spots: byTitle[title],
            routeCount: courses.filter(function (course) { return course.title_name === title; }).length
        };
    }).sort(function (a, b) {
        return b.spots.length - a.spots.length || a.title.localeCompare(b.title, "ja");
    });
}

function render() {
    const keyword = document.getElementById("work-search").value.trim().toLowerCase();
    const list = document.getElementById("work-list");
    list.innerHTML = "";

    const shown = works.filter(function (work) {
        return !keyword || work.title.toLowerCase().includes(keyword);
    });

    if (shown.length === 0) {
        const li = document.createElement("li");
        li.className = "card empty-state";
        li.textContent = keyword ? "見つかりませんでした" : "まだ作品がありません";
        list.appendChild(li);
    }

    shown.forEach(function (work) {
        const li = document.createElement("li");
        const link = document.createElement("a");
        link.className = "card work-card";
        link.href = "work.html?title=" + encodeURIComponent(work.title);
        link.style.setProperty("--work-color", work.color);

        const name = document.createElement("h2");
        name.textContent = work.title;

        const meta = document.createElement("p");
        meta.className = "work-meta";
        meta.textContent = "聖地 " + work.spots.length + "か所" +
            (work.routeCount ? "・おすすめルート " + work.routeCount + "本" : "");

        link.append(name, meta);

        // ログインしていれば、スタンプの進み具合
        if (stampCounts) {
            const got = work.spots.filter(function (spot) { return stampCounts[spot.id]; }).length;
            const progress = document.createElement("div");
            progress.className = "work-progress";
            const bar = document.createElement("span");
            bar.className = "work-progress-bar";
            bar.style.width = Math.round(got / work.spots.length * 100) + "%";
            progress.appendChild(bar);
            const label = document.createElement("p");
            label.className = "work-progress-label";
            label.textContent = "スタンプ " + got + " / " + work.spots.length + (got === work.spots.length ? "　コンプリート！" : "");
            link.append(progress, label);
        }

        li.appendChild(link);
        list.appendChild(li);
    });

    document.getElementById("works-notice").hidden = true;
    list.hidden = false;
}

document.getElementById("work-search").addEventListener("input", function () {
    if (works.length) render();
});

(async function init() {
    // 地図で前に読み込んだ聖地があれば、すぐに出す
    const cached = readCachedSpots();
    if (cached) {
        buildWorks(cached, []);
        render();
    }

    const [spots, courses, counts] = await Promise.all([
        loadSpots().catch(function (error) {
            console.error("聖地を読み込めませんでした:", error);
            return null;
        }),
        loadCourses().catch(function () { return []; }),
        loadMyStampCounts().catch(function () { return null; })
    ]);

    stampCounts = counts;

    if (!spots) {
        if (!cached) showNotice("⚠️", "読み込めませんでした。通信状況を確認して、開き直してください。");
        return;
    }

    buildWorks(spots, courses);
    render();
})();

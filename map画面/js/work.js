// ==========================================
// 作品ページ（work.html?title=作品名）
// その作品の聖地（話数の順）・おすすめルート・スタンプの進み具合・公式サイトを出す。
// 「地図で見る」「このルートで巡る」は地図画面を開いて、その状態にする
// ==========================================
import { getTitleColor, getTitleName } from "./title-colors.js?v=5c634da9";
import { getSpotEpisodeLabel, parseEpisode } from "./episode.js?v=feb7ee57";
import { getSpotImageSrc } from "./spot-image.js?v=59165daf";
import { courseDistance, formatCourseLength } from "./course.js?v=5729311e";
import { loadCourses, loadMyStampCounts, loadSpots, readCachedSpots } from "./public-data.js?v=c815b81a";
import { getCurrentUser } from "./firebase-db.js?v=917161b9";
import { isAiPlanAvailable, readSavedPlan, requestAiPlan, savePlan } from "./ai-plan.js?v=7ad470a0";

const title = new URLSearchParams(location.search).get("title") || "";

function showNotice(icon, text, link) {
    const notice = document.getElementById("work-notice");
    notice.innerHTML = "";
    const iconEl = document.createElement("div");
    iconEl.className = "empty-state-icon";
    iconEl.textContent = icon;
    const p = document.createElement("p");
    p.textContent = text;
    notice.append(iconEl, p);
    if (link) {
        const a = document.createElement("a");
        a.className = "btn btn-primary";
        a.href = link.href;
        a.textContent = link.text;
        notice.appendChild(a);
    }
    notice.hidden = false;
    document.getElementById("work-main").hidden = true;
}

function el(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

// 何期の何話か（入力されていればそれ、無ければ説明文から）。並べ替えに使う
function episodeOrder(spot) {
    const season = Number(spot.season) || 0;
    const episode = Number(spot.episode) || 0;
    const parsed = (season || episode) ? { season: season, episode: episode, special: "" } : parseEpisode(spot.spot_info);

    // 話数の分からない聖地は最後
    if (!parsed.season && !parsed.episode) {
        return [9999, 9999, parsed.special ? 0 : 1];
    }
    return [parsed.season || 1, parsed.episode || 999, 0];
}

function compareEpisode(a, b) {
    const x = episodeOrder(a);
    const y = episodeOrder(b);
    for (let i = 0; i < x.length; i++) {
        if (x[i] !== y[i]) return x[i] - y[i];
    }
    return (a.spot_name || "").localeCompare(b.spot_name || "", "ja");
}

function renderHero(spots, stampCounts) {
    const color = getTitleColor(title);
    document.title = title + " - 聖地巡礼NAVI";
    document.getElementById("work-hero").style.setProperty("--work-color", color);
    document.getElementById("work-title").textContent = title;
    document.getElementById("work-meta").textContent = "聖地 " + spots.length + "か所";
    document.getElementById("work-map").href = "map.html?work=" + encodeURIComponent(title);

    const official = spots.map(function (spot) { return spot.title_url; })
        .find(function (url) { return /^https?:\/\//i.test(url || ""); });
    const officialLink = document.getElementById("work-official");
    officialLink.hidden = !official;
    if (official) officialLink.href = official;

    const progress = document.getElementById("work-progress");
    const label = document.getElementById("work-progress-label");
    if (stampCounts) {
        const got = spots.filter(function (spot) { return stampCounts[spot.id]; }).length;
        document.getElementById("work-progress-bar").style.width = Math.round(got / spots.length * 100) + "%";
        label.textContent = "スタンプ " + got + " / " + spots.length + (got === spots.length ? "　コンプリート！" : "");
        progress.hidden = false;
        label.hidden = false;
    } else {
        progress.hidden = true;
        label.hidden = true;
    }
}

function renderRoutes(courses, spotById) {
    const routes = courses.filter(function (course) { return course.title_name === title; });
    const section = document.getElementById("route-section");
    const list = document.getElementById("work-routes");
    list.innerHTML = "";
    section.hidden = routes.length === 0;

    routes.forEach(function (course) {
        const courseSpots = course.spot_ids.map(function (id) { return spotById[id]; }).filter(Boolean);
        if (courseSpots.length === 0) return;

        const li = el("li", "card work-route");
        li.appendChild(el("h3", "", course.course_name || "おすすめルート"));
        li.appendChild(el("p", "work-meta", courseSpots.length + "か所・" + formatCourseLength(courseDistance(courseSpots))));
        if (course.description) li.appendChild(el("p", "work-route-description", course.description));

        const stops = el("ol", "work-route-stops");
        courseSpots.forEach(function (spot) { stops.appendChild(el("li", "", spot.spot_name || "無題のスポット")); });
        li.appendChild(stops);

        const start = el("a", "btn btn-primary", "このルートで巡る");
        start.href = "map.html?course=" + encodeURIComponent(course.id);
        li.appendChild(start);

        list.appendChild(li);
    });
}

// ---------- AI におまかせプラン ----------

// 「約3時間10分」
function formatMinutes(minutes) {
    if (minutes < 60) return "約" + minutes + "分";
    return "約" + Math.floor(minutes / 60) + "時間" + (minutes % 60 ? minutes % 60 + "分" : "");
}

function renderAiPlan(plan) {
    const result = document.getElementById("ai-plan-result");
    result.innerHTML = "";

    result.appendChild(el("h3", "", plan.title));
    if (plan.summary) result.appendChild(el("p", "ai-plan-summary", plan.summary));
    result.appendChild(el("p", "work-meta",
        plan.stops.length + "か所・" + formatCourseLength(plan.walk_meters) + "・滞在を入れて合計 " + formatMinutes(plan.total_minutes)));

    const stops = el("ol", "work-route-stops ai-plan-stops");
    plan.stops.forEach(function (stop) {
        const li = el("li");
        const head = el("div", "ai-plan-stop-head");
        head.appendChild(el("span", "ai-plan-stop-name", stop.name));
        const episode = getSpotEpisodeLabel(stop);
        if (episode) head.appendChild(el("span", "work-ep", episode));
        head.appendChild(el("span", "ai-plan-stay", "滞在 " + formatMinutes(stop.stay_minutes)));
        li.appendChild(head);
        if (stop.comment) li.appendChild(el("p", "ai-plan-comment", stop.comment));
        stops.appendChild(li);
    });
    result.appendChild(stops);

    const start = el("a", "btn btn-primary", "地図でこのプランを開く");
    start.href = "map.html?route=" + encodeURIComponent(plan.stops.map(function (stop) { return stop.id; }).join(","));
    result.appendChild(start);

    result.appendChild(el("p", "ai-plan-note",
        "AI が作った目安です。電車の乗換は、地図のルート案内の「🚃 電車で」から確かめてください。"));

    result.hidden = false;
    document.getElementById("ai-plan-btn").textContent = "別のマイプランを作ってもらう";
}

let aiSectionReady = false;

async function setupAiSection() {
    if (aiSectionReady || !isAiPlanAvailable()) return;
    aiSectionReady = true;

    const form = document.getElementById("ai-plan-form");
    const button = document.getElementById("ai-plan-btn");
    const status = document.getElementById("ai-plan-status");
    document.getElementById("ai-section").hidden = false;

    const saved = readSavedPlan(title);
    if (saved) renderAiPlan(saved);

    if (!await getCurrentUser()) {
        document.getElementById("ai-plan-login").hidden = false;
        status.textContent = "ログインすると使えます（1日の回数に限りがあります）。";
        return;
    }
    form.hidden = false;

    form.addEventListener("submit", async function (event) {
        event.preventDefault();
        button.disabled = true;
        status.textContent = "AI がプランを考えています…（数十秒かかることがあります）";
        try {
            const { plan, remaining } = await requestAiPlan(title, {
                duration: document.getElementById("ai-duration").value,
                start: document.getElementById("ai-start").value.trim(),
                wishes: document.getElementById("ai-wishes").value.trim()
            });
            savePlan(title, plan);
            renderAiPlan(plan);
            status.textContent = "プランができました。今日はあと " + remaining + " 回作れます。";
        } catch (error) {
            status.textContent = error.message;
        } finally {
            button.disabled = false;
        }
    });
}

function renderSpots(spots, stampCounts) {
    const list = document.getElementById("work-spots");
    list.innerHTML = "";

    spots.slice().sort(compareEpisode).forEach(function (spot) {
        const li = el("li", "card work-spot");

        const imageSrc = getSpotImageSrc(spot.image_url);
        if (imageSrc) {
            const img = el("img", "work-spot-image");
            img.src = imageSrc;
            img.alt = "";
            img.loading = "lazy";
            img.onerror = function () { img.remove(); };
            li.appendChild(img);
        }

        const head = el("div", "work-spot-head");
        const episode = getSpotEpisodeLabel(spot);
        if (episode) head.appendChild(el("span", "work-ep", episode));
        head.appendChild(el("h3", "", spot.spot_name || "無題のスポット"));
        if (stampCounts && stampCounts[spot.id]) {
            const done = el("span", "work-done", "✓ 獲得" + (stampCounts[spot.id] > 1 ? " ×" + stampCounts[spot.id] : ""));
            head.appendChild(done);
        }
        li.appendChild(head);

        if (spot.spot_info) li.appendChild(el("p", "work-spot-info", spot.spot_info));

        const view = el("a", "btn btn-secondary work-spot-map", "地図で見る");
        view.href = "map.html?spot=" + encodeURIComponent(spot.id);
        li.appendChild(view);

        list.appendChild(li);
    });
}

function render(allSpots, courses, stampCounts) {
    const spots = allSpots.filter(function (spot) { return getTitleName(spot) === title; });
    if (spots.length === 0) {
        showNotice("🔍", "「" + title + "」の聖地は見つかりませんでした。", { href: "works.html", text: "作品一覧へ" });
        return false;
    }

    const spotById = {};
    allSpots.forEach(function (spot) { spotById[spot.id] = spot; });

    renderHero(spots, stampCounts);
    renderRoutes(courses, spotById);
    renderSpots(spots, stampCounts);
    setupAiSection();

    document.getElementById("work-notice").hidden = true;
    document.getElementById("work-main").hidden = false;
    return true;
}

(async function init() {
    if (!title) {
        showNotice("🔍", "作品が指定されていません。", { href: "works.html", text: "作品一覧へ" });
        return;
    }

    // 地図で前に読み込んだ聖地があれば、すぐに出す
    const cached = readCachedSpots();
    const shownFromCache = cached ? render(cached, [], null) : false;

    const [spots, courses, counts] = await Promise.all([
        loadSpots().catch(function (error) {
            console.error("聖地を読み込めませんでした:", error);
            return null;
        }),
        loadCourses().catch(function () { return []; }),
        loadMyStampCounts().catch(function () { return null; })
    ]);

    if (!spots) {
        if (!shownFromCache) showNotice("⚠️", "読み込めませんでした。通信状況を確認して、開き直してください。");
        return;
    }

    render(spots, courses, counts);
})();

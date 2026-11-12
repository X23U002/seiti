// ==========================================
// AI でつくるマイプラン（地図の「おすすめルート」の画面）
// 作品と条件（使える時間・出発地・希望）を選ぶと、その人向けのプランを AI が作る。
// 「このプランで巡る」でルート案内に入れる（運営のおすすめルートと同じ使い方）
// ==========================================
import { getCurrentUser } from "./firebase-db.js?v=61accae5";
import { getSpotEpisodeLabel } from "./episode.js?v=9a2ff22f";
import { formatCourseLength } from "./course.js?v=5729311e";
import { isAiPlanAvailable, readSavedPlan, requestAiPlan, savePlan } from "./ai-plan.js?v=39fb6815";

// 「約3時間10分」
function formatMinutes(minutes) {
    if (minutes < 60) return "約" + minutes + "分";
    return "約" + Math.floor(minutes / 60) + "時間" + (minutes % 60 ? minutes % 60 + "分" : "");
}

function el(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

let options = null;

function renderPlan(plan) {
    const result = document.getElementById("my-plan-result");
    result.innerHTML = "";

    if (!plan) {
        result.hidden = true;
        return;
    }

    const card = el("article", "course-card my-plan-card");
    card.appendChild(el("h4", "", plan.title));
    card.appendChild(el("p", "course-meta",
        plan.stops.length + "か所・" + formatCourseLength(plan.walk_meters) + "・滞在を入れて合計 " + formatMinutes(plan.total_minutes)));
    if (plan.summary) card.appendChild(el("p", "course-description", plan.summary));

    const stops = el("ol", "course-stops my-plan-stops");
    plan.stops.forEach(function (stop) {
        const li = el("li");
        const head = el("div", "my-plan-stop-head");
        head.appendChild(el("span", "my-plan-stop-name", stop.name));
        const episode = getSpotEpisodeLabel(stop);
        if (episode) head.appendChild(el("span", "popup-ep", episode));
        head.appendChild(el("span", "my-plan-stay", "滞在 " + formatMinutes(stop.stay_minutes)));
        li.appendChild(head);
        if (stop.comment) li.appendChild(el("p", "my-plan-comment", stop.comment));
        stops.appendChild(li);
    });
    card.appendChild(stops);

    const start = el("button", "course-start my-plan-start", "このプランで巡る");
    start.type = "button";
    start.addEventListener("click", function () {
        options.startPlan(plan);
    });
    card.appendChild(start);

    card.appendChild(el("p", "my-plan-note",
        "AI が作った目安です。電車の乗換は、ルート案内の「🚃 電車で」から確かめてください。"));

    result.appendChild(card);
    result.hidden = false;
}

function selectedTitle() {
    return document.getElementById("my-plan-title").value;
}

// 作品の選択肢を作り直す（聖地の読み込みや、絞り込みが変わった時）
export function refreshMyPlan() {
    if (!options) return;

    const select = document.getElementById("my-plan-title");
    const titles = options.getTitles();
    const current = select.value || options.getDefaultTitle();

    select.innerHTML = "";
    titles.forEach(function (title) {
        const option = el("option", "", title);
        option.value = title;
        select.appendChild(option);
    });
    if (titles.includes(current)) select.value = current;

    document.getElementById("my-plan-submit").textContent =
        readSavedPlan(selectedTitle()) ? "別のマイプランを作ってもらう" : "マイプランを作ってもらう";
    renderPlan(readSavedPlan(selectedTitle()));
}

// startPlan(plan)：プランをルート案内に入れる
// getTitles()：選べる作品（聖地が2か所以上ある作品）
// getDefaultTitle()：最初に選んでおく作品（絞り込み中の作品など）
export async function setupMyPlan(settings) {
    const section = document.getElementById("my-plan");
    if (!section || !isAiPlanAvailable()) return;

    options = settings;
    section.hidden = false;

    // おすすめルートの一覧の上から、マイプランの欄へ移る
    const jump = document.getElementById("my-plan-jump");
    jump.hidden = false;
    jump.addEventListener("click", function (event) {
        event.preventDefault();
        section.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    const form = document.getElementById("my-plan-form");
    const button = document.getElementById("my-plan-submit");
    const status = document.getElementById("my-plan-status");
    const select = document.getElementById("my-plan-title");

    select.addEventListener("change", function () {
        status.textContent = "";
        button.textContent = readSavedPlan(select.value) ? "別のマイプランを作ってもらう" : "マイプランを作ってもらう";
        renderPlan(readSavedPlan(select.value));
    });

    form.addEventListener("submit", async function (event) {
        event.preventDefault();
        const title = selectedTitle();
        if (!title) return;

        button.disabled = true;
        status.textContent = "AI がプランを考えています…（数十秒かかることがあります）";
        try {
            const { plan, remaining } = await requestAiPlan(title, {
                duration: document.getElementById("my-plan-duration").value,
                start: document.getElementById("my-plan-start").value.trim(),
                wishes: document.getElementById("my-plan-wishes").value.trim()
            });
            savePlan(title, plan);
            renderPlan(plan);
            button.textContent = "別のマイプランを作ってもらう";
            status.textContent = "プランができました。今日はあと " + remaining + " 回作れます。";
        } catch (error) {
            status.textContent = error.message;
        } finally {
            button.disabled = false;
        }
    });

    refreshMyPlan();

    if (!await getCurrentUser()) {
        form.hidden = true;
        document.getElementById("my-plan-login").hidden = false;
        status.textContent = "ログインすると使えます（1日の回数に限りがあります）。";
    }
}

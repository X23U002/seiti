// ==========================================
// 地図を開いた時の案内（はじめての人への使い方の説明と、現在地を使ってよいかの確認）
// ・はじめて開いた時だけ、使い方を3枚で説明し、最後に現在地を使うかを聞く
// ・2回目からは、現在地を許可していなければ、理由を書いた小さな案内を出す（断られたら1週間は出さない）
// ・何のアプリか分かる前に、いきなりブラウザの「位置情報を許可しますか？」を出さないため
// ・アプリを開くたびに1回、巡礼の前の注意（歩きスマホ・私有地・撮影のマナーなど）を出す
//   （同じ画面を開いている間は、ページを移っても出さない。はじめての人には説明の中の1枚として出す）
// ==========================================

const ONBOARDED_KEY = "seitiOnboarded";
const SAFETY_SHOWN_KEY = "seitiSafetyShown";

// 巡礼の前の注意
const SAFETY_TITLE = "巡礼の前に";
const SAFETY_ITEMS = [
    ["🚶", "歩きスマホはやめましょう。地図を見る時は、安全な場所で立ち止まって"],
    ["🚗", "道路や線路の近くでは、車や電車に気をつけて"],
    ["🏠", "私有地や立入禁止の場所には入らない"],
    ["🤫", "地元の方の迷惑にならないよう、大声や長居は控えめに"],
    ["📷", "人が写る撮影は控え、通る人の邪魔にならないように"],
    ["🗑️", "ゴミは持ち帰りましょう"]
];
const LOCATION_ASKED_KEY = "seitiLocationAskedAt";
const ASK_AGAIN_MS = 7 * 24 * 60 * 60 * 1000;

const STEPS = [
    {
        icon: "🗺️",
        title: "聖地を探す",
        text: "地図のピンを押すと、その聖地の場面や写真が見られます。「作品で絞り込み」で好きな作品だけにもできます。"
    },
    {
        icon: "🚶",
        title: "ルートを作って巡る",
        text: "行きたい聖地を「ルートに追加」すると、回る順番と道のり・時間が分かります。電車の乗換も調べられます。"
    },
    {
        icon: "⛩️",
        title: "聖地でスタンプを集める",
        text: "聖地の近くまで行くと、スタンプが押せます。作品の聖地を全部回ってコンプリートを目指しましょう。"
    }
];

// 今開いている間に、巡礼の前の注意を出したか（sessionStorage：アプリを閉じると消える）
function wasSafetyShown() {
    try {
        return sessionStorage.getItem(SAFETY_SHOWN_KEY) === "1";
    } catch (error) {
        return false;
    }
}

function markSafetyShown() {
    try {
        sessionStorage.setItem(SAFETY_SHOWN_KEY, "1");
    } catch (error) {
        // 保存できない環境では、ページを開くたびに出る
    }
}

// 注意の一覧（説明の1枚と、開いた時の注意で共通）
function createSafetyList() {
    const list = el("ul", "safety-list");
    SAFETY_ITEMS.forEach(function (item) {
        const li = el("li");
        li.appendChild(el("span", "safety-icon", item[0]));
        li.appendChild(el("span", "", item[1]));
        list.appendChild(li);
    });
    return list;
}

function readStorage(key) {
    try {
        return localStorage.getItem(key) || "";
    } catch (error) {
        return "";
    }
}

function writeStorage(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (error) {
        // 保存できない環境では、次に開いた時もう一度出るだけ
    }
}

// 位置情報の許可の状態（"granted" / "prompt" / "denied"。分からなければ "prompt"）
async function getLocationPermission() {
    try {
        const status = await navigator.permissions.query({ name: "geolocation" });
        return status.state;
    } catch (error) {
        return "prompt";
    }
}

// 地図を動かさずに、位置情報の許可だけもらう
function requestPermissionOnly() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(function () {}, function () {});
    }
}

function el(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

// はじめての人への説明（3枚＋現在地の確認）
function showGuide(permission, useLocation) {
    const overlay = el("div", "onboarding");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "onboarding-title");

    const card = el("div", "onboarding-card");
    overlay.appendChild(card);

    const steps = STEPS.concat(
        [{ icon: "⚠️", title: SAFETY_TITLE, safety: true }],
        permission === "denied"
            ? [{
                icon: "📍",
                title: "位置情報がオフになっています",
                text: "スタンプ集めと現在地からの道案内には、現在地を使います。使う時は、ブラウザの設定でこのサイトの位置情報を許可してください。"
            }]
            : [{
                icon: "📍",
                title: "現在地を使いますか？",
                text: "近くの聖地でスタンプを押す時と、現在地からの道案内に使います。次の画面で「許可」を選んでください。",
                askLocation: true
            }]
    );

    let index = 0;

    markSafetyShown();

    function finish(allowLocation) {
        writeStorage(ONBOARDED_KEY, "1");
        writeStorage(LOCATION_ASKED_KEY, String(Date.now()));
        overlay.remove();
        if (allowLocation) {
            useLocation();
        }
    }

    function render() {
        const step = steps[index];
        card.innerHTML = "";

        card.appendChild(el("div", "onboarding-icon", step.icon));
        const title = el("h2", "onboarding-title", step.title);
        title.id = "onboarding-title";
        card.appendChild(title);
        if (step.safety) {
            card.appendChild(createSafetyList());
        } else {
            card.appendChild(el("p", "onboarding-text", step.text));
        }

        // 何枚目か（●○○○）
        const dots = el("div", "onboarding-dots");
        dots.setAttribute("aria-label", (index + 1) + " / " + steps.length);
        steps.forEach(function (_, i) {
            dots.appendChild(el("span", i === index ? "is-current" : ""));
        });
        card.appendChild(dots);

        const buttons = el("div", "onboarding-buttons");
        const isLast = index === steps.length - 1;

        if (isLast && step.askLocation) {
            const later = el("button", "onboarding-secondary", "あとで");
            later.type = "button";
            later.addEventListener("click", function () { finish(false); });
            const allow = el("button", "onboarding-primary", "現在地を使う");
            allow.type = "button";
            allow.addEventListener("click", function () { finish(true); });
            buttons.append(later, allow);
        } else if (isLast) {
            const start = el("button", "onboarding-primary", "はじめる");
            start.type = "button";
            start.addEventListener("click", function () { finish(false); });
            buttons.appendChild(start);
        } else {
            const skip = el("button", "onboarding-secondary", "スキップ");
            skip.type = "button";
            // 飛ばしても、巡礼の前の注意は見てもらう
            skip.addEventListener("click", function () {
                const safetyIndex = steps.findIndex(function (item) { return item.safety; });
                index = index < safetyIndex ? safetyIndex : steps.length - 1;
                render();
            });
            const next = el("button", "onboarding-primary", "次へ");
            next.type = "button";
            next.addEventListener("click", function () {
                index++;
                render();
            });
            buttons.append(skip, next);
        }

        card.appendChild(buttons);
        buttons.querySelector(".onboarding-primary").focus();
    }

    document.body.appendChild(overlay);
    render();
}

// アプリを開いた時の、巡礼の前の注意（「わかった」で閉じる）
function showSafetyNotice() {
    markSafetyShown();

    return new Promise(function (resolve) {
        const overlay = el("div", "onboarding safety-notice");
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-labelledby", "safety-title");

        const card = el("div", "onboarding-card");
        card.appendChild(el("div", "onboarding-icon", "⚠️"));
        const title = el("h2", "onboarding-title", SAFETY_TITLE);
        title.id = "safety-title";
        card.appendChild(title);
        card.appendChild(createSafetyList());

        const buttons = el("div", "onboarding-buttons");
        const ok = el("button", "onboarding-primary", "わかった");
        ok.type = "button";
        buttons.appendChild(ok);
        card.appendChild(buttons);
        overlay.appendChild(card);

        function close() {
            document.removeEventListener("keydown", onKey);
            overlay.remove();
            resolve();
        }
        function onKey(event) {
            if (event.key === "Escape") close();
        }
        ok.addEventListener("click", close);
        document.addEventListener("keydown", onKey);

        document.body.appendChild(overlay);
        ok.focus();
    });
}

// 今開いている間にまだ出していなければ、巡礼の前の注意を出す
function showSafetyOnce() {
    return wasSafetyShown() ? Promise.resolve() : showSafetyNotice();
}

// 2回目からの、現在地を使うかの小さな案内（地図の上に出し、地図は使えるまま）
function showLocationCard(useLocation) {
    const card = el("div", "location-card");
    card.setAttribute("role", "region");
    card.setAttribute("aria-label", "現在地を使うかの確認");

    card.appendChild(el("p", "location-card-text",
        "📍 現在地を使うと、近くの聖地でスタンプが押せて、現在地からの道案内も使えます。"));

    const buttons = el("div", "location-card-buttons");
    const later = el("button", "onboarding-secondary", "あとで");
    later.type = "button";
    const allow = el("button", "onboarding-primary", "現在地を使う");
    allow.type = "button";
    buttons.append(later, allow);
    card.appendChild(buttons);

    function close(allowLocation) {
        writeStorage(LOCATION_ASKED_KEY, String(Date.now()));
        card.remove();
        if (allowLocation) {
            useLocation();
        }
    }
    later.addEventListener("click", function () { close(false); });
    allow.addEventListener("click", function () { close(true); });

    document.body.appendChild(card);
}

// 地図を開いた時に呼ぶ。useLocation：現在地を取り始める（地図の現在地ボタンと同じ）
// askLocation：現在地を聞いてよいか（聖地を指定して開いた時など、地図が動くと困る時は false）
export async function startOnboarding(useLocation, askLocation) {
    const permission = await getLocationPermission();

    // 許可済みなら、これまでどおりすぐ現在地を取る
    if (permission === "granted") {
        if (askLocation) useLocation();
        if (!readStorage(ONBOARDED_KEY)) writeStorage(ONBOARDED_KEY, "1");
        await showSafetyOnce();
        return;
    }

    if (!readStorage(ONBOARDED_KEY)) {
        // 聖地を指定して開いた時は、地図を動かさずに許可だけもらう
        showGuide(permission, askLocation ? useLocation : requestPermissionOnly);
        return;
    }

    // 現在地の案内より先に、巡礼の前の注意を出す（重ならないように）
    await showSafetyOnce();

    if (!askLocation || permission === "denied") {
        return;
    }

    const askedAt = Number(readStorage(LOCATION_ASKED_KEY)) || 0;
    if (Date.now() - askedAt < ASK_AGAIN_MS) {
        return;
    }

    showLocationCard(useLocation);
}

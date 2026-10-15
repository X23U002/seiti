// ==========================================
// 管理ページ（admin コレクションに uid がある人だけ使える）
// ・聖地の申請（request_spot）を確認して、spot に追加する／却下する
// ・お問い合わせ（contact）の対応状況を変える・返信する
// ・申請者・お問い合わせした人のメールボックス（message）にお知らせを届ける
// ・登録済みの聖地の「何期の何話か」（spot の season・episode）を入力する
// 誰が管理者かは Firestore のルールでも確かめている（画面を開けても、管理者でなければ読み書きできない）
// ==========================================
import {
    collection,
    doc,
    getDoc,
    getDocs,
    GeoPoint,
    serverTimestamp,
    updateDoc,
    writeBatch
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

import { db, getCurrentUser } from "./firebase-db.js";
import { getTitleColor } from "./title-colors.js";
import { parseEpisode } from "./episode.js?v=2";

// 地図画面と同じキー
mapboxgl.accessToken =
    "pk.eyJ1Ijoia3Vyb211IiwiYSI6ImNtcDBqcGpjNjB3Y2EycnE2a3d6cGhmbG4ifQ.lQ-HQ1PQVvgpxSvj8J_9rA";

// 申請・お問い合わせの状態（ルールで決めている値）
const OPEN_REQUEST_STATES = ["申請中", "許可"];
const OPEN_CONTACT_STATES = ["未対応", "対応"];

let requests = [];          // { id, data, user }
let contacts = [];          // { id, data, user }
let titleUrls = {};         // 作品名 → 公式サイト（既にある聖地から）
let spots = [];             // { id, data }（期・話の入力に使う）
let approving = null;       // 確認中の申請
let approveMap = null;
let approveMarker = null;

// ---------- 画面の状態 ----------
function showNotice(icon, text, sub) {
    const notice = document.getElementById("admin-notice");
    notice.hidden = false;
    notice.innerHTML = "";
    const iconEl = document.createElement("div");
    iconEl.className = "empty-state-icon";
    iconEl.textContent = icon;
    const p = document.createElement("p");
    p.textContent = text;
    notice.append(iconEl, p);
    if (sub) {
        const small = document.createElement("small");
        small.textContent = sub;
        notice.appendChild(small);
    }
    document.getElementById("admin-main").hidden = true;
}

function notify(message, type) {
    if (typeof window.showToast === "function") {
        window.showToast(message, type);
    }
}

// ---------- 読み込み ----------
async function loadUsers(items) {
    const ids = [...new Set(items.map(function (item) {
        return item.data.user_id && item.data.user_id.id;
    }).filter(Boolean))];

    const users = {};
    await Promise.all(ids.map(async function (id) {
        try {
            const snap = await getDoc(doc(db, "user", id));
            users[id] = snap.exists() ? snap.data() : null;
        } catch (e) {
            users[id] = null;
        }
    }));

    items.forEach(function (item) {
        const id = item.data.user_id && item.data.user_id.id;
        item.user = users[id] || null;
    });
}

async function loadAll() {
    const [requestSnap, contactSnap, spotSnap] = await Promise.all([
        getDocs(collection(db, "request_spot")),
        getDocs(collection(db, "contact")),
        getDocs(collection(db, "spot"))
    ]);

    requests = [];
    requestSnap.forEach(function (d) { requests.push({ id: d.id, data: d.data() }); });
    contacts = [];
    contactSnap.forEach(function (d) { contacts.push({ id: d.id, data: d.data() }); });

    titleUrls = {};
    spots = [];
    spotSnap.forEach(function (d) {
        const spot = d.data();
        spots.push({ id: d.id, data: spot });
        if (spot.title_name && spot.title_url && !titleUrls[spot.title_name]) {
            titleUrls[spot.title_name] = spot.title_url;
        }
    });

    const datalist = document.getElementById("title-options");
    datalist.innerHTML = "";
    Object.keys(titleUrls).sort().forEach(function (title) {
        const option = document.createElement("option");
        option.value = title;
        datalist.appendChild(option);
    });

    await Promise.all([loadUsers(requests), loadUsers(contacts)]);
}

// ---------- 表示 ----------
function userLabel(user) {
    if (!user) return "（ユーザー情報なし）";
    return (user.user_name || "名前なし") + (user.mail_address ? "（" + user.mail_address + "）" : "");
}

function stateBadge(state) {
    const badge = document.createElement("span");
    badge.className = "state-badge state-" + ({
        "申請中": "new", "未対応": "new",
        "許可": "doing", "対応": "doing",
        "完了": "done", "対応済み": "done",
        "却下": "rejected"
    }[state] || "new");
    badge.textContent = state || "-";
    return badge;
}

// request_info は「作品名：…／住所：…／説明：…」の形で送られてくる
function parseRequestInfo(text) {
    const result = { title: "", address: "", info: "" };
    const lines = String(text || "").split("\n");
    let inInfo = false;
    lines.forEach(function (line) {
        if (inInfo) {
            result.info += "\n" + line;
        } else if (line.startsWith("作品名：")) {
            result.title = line.slice(4);
        } else if (line.startsWith("住所：")) {
            result.address = line.slice(3);
        } else if (line.startsWith("説明：")) {
            result.info = line.slice(3);
            inInfo = true;
        }
    });
    if (!result.title && !result.address && !result.info) {
        result.info = String(text || "");
    }
    return result;
}

function render() {
    const showDone = document.getElementById("show-done").checked;

    const openRequests = requests.filter(function (r) {
        return OPEN_REQUEST_STATES.includes(r.data.request_state);
    });
    const openContacts = contacts.filter(function (c) {
        return OPEN_CONTACT_STATES.includes(c.data.contact_state);
    });
    document.getElementById("count-requests").textContent = openRequests.length;
    document.getElementById("count-contacts").textContent = openContacts.length;

    renderRequests(showDone ? requests : openRequests);
    renderContacts(showDone ? contacts : openContacts);
}

function emptyItem(text) {
    const li = document.createElement("li");
    li.className = "card admin-empty";
    li.textContent = text;
    return li;
}

function renderRequests(list) {
    const ul = document.getElementById("request-list");
    ul.innerHTML = "";
    if (list.length === 0) {
        ul.appendChild(emptyItem("確認待ちの申請はありません"));
        return;
    }

    list.forEach(function (item) {
        const parsed = parseRequestInfo(item.data.request_info);
        const li = document.createElement("li");
        li.className = "card admin-item";

        const head = document.createElement("div");
        head.className = "item-head";
        const title = document.createElement("h2");
        title.textContent = item.data.request_title || "（スポット名なし）";
        head.append(title, stateBadge(item.data.request_state));

        const dl = document.createElement("dl");
        dl.className = "item-detail";
        [["作品名", parsed.title], ["住所", parsed.address], ["説明", parsed.info], ["申請者", userLabel(item.user)]]
            .forEach(function (row) {
                const dt = document.createElement("dt");
                dt.textContent = row[0];
                const dd = document.createElement("dd");
                dd.textContent = row[1] || "-";
                dl.append(dt, dd);
            });

        li.append(head, dl);

        if (OPEN_REQUEST_STATES.includes(item.data.request_state)) {
            const actions = document.createElement("div");
            actions.className = "item-actions";

            const approve = document.createElement("button");
            approve.type = "button";
            approve.className = "btn btn-success";
            approve.textContent = "確認して地図に追加";
            approve.onclick = function () { openApprove(item); };

            const reject = document.createElement("button");
            reject.type = "button";
            reject.className = "btn btn-secondary";
            reject.textContent = "却下";
            reject.onclick = function () { rejectRequest(item, reject); };

            actions.append(approve, reject);
            li.appendChild(actions);
        }

        ul.appendChild(li);
    });
}

function renderContacts(list) {
    const ul = document.getElementById("contact-list");
    ul.innerHTML = "";
    if (list.length === 0) {
        ul.appendChild(emptyItem("対応待ちのお問い合わせはありません"));
        return;
    }

    list.forEach(function (item) {
        const li = document.createElement("li");
        li.className = "card admin-item";

        const head = document.createElement("div");
        head.className = "item-head";
        const who = document.createElement("h2");
        who.textContent = item.user ? (item.user.user_name || "名前なし") : "（ユーザー情報なし）";
        head.append(who, stateBadge(item.data.contact_state));

        const body = document.createElement("p");
        body.className = "contact-body";
        body.textContent = item.data.contact_info || "";

        li.append(head, body);

        if (item.user && item.user.mail_address) {
            const mail = document.createElement("p");
            mail.className = "contact-mail";
            mail.textContent = "✉ " + item.user.mail_address;
            li.appendChild(mail);
        }

        const reply = document.createElement("button");
        reply.type = "button";
        reply.className = "btn btn-primary reply-btn";
        reply.textContent = "返信する（メールボックス・メール）";
        reply.onclick = function () { openReply(item); };
        li.appendChild(reply);

        const actions = document.createElement("div");
        actions.className = "item-actions";
        ["未対応", "対応", "対応済み"].forEach(function (state) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "btn " + (item.data.contact_state === state ? "btn-primary" : "btn-secondary");
            button.textContent = state;
            button.disabled = item.data.contact_state === state;
            button.onclick = function () { setContactState(item, state, button); };
            actions.appendChild(button);
        });
        li.appendChild(actions);

        ul.appendChild(li);
    });
}

// ---------- メールボックス（message）にお知らせを入れる ----------
// batch に追加するだけなので、他の書き込みと同時に保存される
function addMessage(batch, userRef, title, body) {
    if (!userRef || !userRef.id) return;
    batch.set(doc(collection(db, "message")), {
        user_id: doc(db, "user", userRef.id),
        title: title,
        body: body,
        created_at: serverTimestamp(),
        is_read: false
    });
}

// ---------- お問い合わせの状態を変える ----------
async function setContactState(item, state, button) {
    button.disabled = true;
    try {
        await updateDoc(doc(db, "contact", item.id), { contact_state: state });
        item.data.contact_state = state;
        notify("「" + state + "」にしました");
        render();
    } catch (error) {
        console.error(error);
        notify("変更できませんでした（権限・通信を確認してください）", "error");
        button.disabled = false;
    }
}

// ---------- お問い合わせに返信する ----------
let replying = null;

function openReply(item) {
    replying = item;
    const email = item.user && item.user.mail_address;
    document.getElementById("reply-to").textContent =
        (item.user ? (item.user.user_name || "名前なし") : "（ユーザー情報なし）") + (email ? "（" + email + "）" : "");
    document.getElementById("reply-original").textContent = item.data.contact_info || "";
    document.getElementById("reply-title").value = "お問い合わせへの回答";
    document.getElementById("reply-body").value = "";
    document.getElementById("reply-mail").checked = Boolean(email);
    document.getElementById("reply-mail").disabled = !email;
    document.getElementById("reply-error").hidden = true;
    setFieldError("reply-body", false);
    document.getElementById("reply-modal").style.display = "flex";
    document.getElementById("reply-body").focus();
}

window.closeReply = function () {
    document.getElementById("reply-modal").style.display = "none";
    replying = null;
};

document.getElementById("reply-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!replying) return;

    const title = document.getElementById("reply-title").value.trim() || "お問い合わせへの回答";
    const body = document.getElementById("reply-body").value.trim();
    setFieldError("reply-body", body === "");
    if (body === "") {
        document.getElementById("reply-body").focus();
        return;
    }

    const button = document.getElementById("reply-submit");
    button.disabled = true;
    button.textContent = "送信中…";

    // 返信の本文に、お問い合わせの内容を引用して付ける
    const fullBody = body + "\n\n――― お問い合わせ内容 ―――\n" + (replying.data.contact_info || "");

    try {
        // メールボックスへの返信と、お問い合わせを「対応済み」にするのを同時に行う
        const batch = writeBatch(db);
        addMessage(batch, replying.data.user_id, title, fullBody);
        batch.update(doc(db, "contact", replying.id), { contact_state: "対応済み" });
        await batch.commit();

        replying.data.contact_state = "対応済み";
        const email = replying.user && replying.user.mail_address;
        const sendMail = document.getElementById("reply-mail").checked && email;
        window.closeReply();
        render();
        notify("メールボックスに返信しました");

        // メールでも送る時は、メールアプリを開く（送信ボタンは自分で押す）
        if (sendMail) {
            window.location.href = "mailto:" + encodeURIComponent(email) +
                "?subject=" + encodeURIComponent("【聖地巡礼NAVI】" + title) +
                "&body=" + encodeURIComponent(fullBody);
        }
    } catch (error) {
        console.error(error);
        const box = document.getElementById("reply-error");
        box.textContent = error && error.code === "permission-denied"
            ? "返信する権限がありません。Firestore のルール（message）を確認してください。"
            : "送信できませんでした。通信状況を確認して、もう一度お試しください。";
        box.hidden = false;
    } finally {
        button.disabled = false;
        button.textContent = "返信する";
    }
});

// ---------- 申請を却下する ----------
async function rejectRequest(item, button) {
    const title = item.data.request_title || "この申請";
    // キャンセルしたら null、空欄で OK なら理由なし
    const reason = window.prompt("「" + title + "」を却下します。\n申請者に伝える理由があれば入力してください（空欄でも却下できます）", "");
    if (reason === null) return;
    button.disabled = true;
    try {
        const batch = writeBatch(db);
        batch.update(doc(db, "request_spot", item.id), { request_state: "却下" });
        addMessage(batch, item.data.user_id, "聖地の登録申請について",
            "「" + title + "」の登録申請を確認しましたが、今回は地図への追加を見送りました。" +
            (reason.trim() ? "\n\n理由：" + reason.trim() : "") +
            "\n\nご協力いただき、ありがとうございました。");
        await batch.commit();
        item.data.request_state = "却下";
        notify("却下しました");
        render();
    } catch (error) {
        console.error(error);
        notify("却下できませんでした（権限・通信を確認してください）", "error");
        button.disabled = false;
    }
}

// ---------- 申請を確認して地図に追加する ----------
// 緯度経度から geohash（8文字）を作る（既にある聖地と同じ精度）
function encodeGeohash(latitude, longitude, precision) {
    const base32 = "0123456789bcdefghjkmnpqrstuvwxyz";
    let latRange = [-90, 90];
    let lngRange = [-180, 180];
    let hash = "";
    let bit = 0;
    let ch = 0;
    let even = true;

    while (hash.length < precision) {
        const range = even ? lngRange : latRange;
        const value = even ? longitude : latitude;
        const mid = (range[0] + range[1]) / 2;
        if (value >= mid) {
            ch = (ch << 1) | 1;
            range[0] = mid;
        } else {
            ch = ch << 1;
            range[1] = mid;
        }
        even = !even;
        if (++bit === 5) {
            hash += base32[ch];
            bit = 0;
            ch = 0;
        }
    }
    return hash;
}

function setApprovePosition(lngLat, fly) {
    if (!approveMarker) {
        approveMarker = new mapboxgl.Marker({ draggable: true, color: "#e53935" })
            .setLngLat(lngLat)
            .addTo(approveMap);
        approveMarker.on("dragend", function () {
            showCoord(approveMarker.getLngLat());
        });
    } else {
        approveMarker.setLngLat(lngLat);
    }
    showCoord(approveMarker.getLngLat());
    if (fly) {
        approveMap.flyTo({ center: lngLat, zoom: 16 });
    }
}

function showCoord(lngLat) {
    document.getElementById("ap-coord-text").textContent =
        "位置：緯度 " + lngLat.lat.toFixed(6) + "／経度 " + lngLat.lng.toFixed(6) + "（ピンはドラッグで動かせます）";
    setFieldError("ap-address", false);
}

async function geocodeAddress() {
    const address = document.getElementById("ap-address").value.trim();
    if (!address) return;

    const button = document.getElementById("ap-geocode");
    button.disabled = true;
    try {
        const url = "https://api.mapbox.com/geocoding/v5/mapbox.places/" + encodeURIComponent(address) +
            ".json?access_token=" + mapboxgl.accessToken + "&language=ja&country=jp&limit=1";
        const result = await (await fetch(url)).json();
        const feature = result.features && result.features[0];
        if (!feature) {
            notify("住所から位置が見つかりませんでした。地図をタップしてください", "error");
            return;
        }
        setApprovePosition({ lng: feature.center[0], lat: feature.center[1] }, true);
    } catch (error) {
        console.error(error);
        notify("位置を調べられませんでした", "error");
    } finally {
        button.disabled = false;
    }
}

function openApprove(item) {
    approving = item;
    const parsed = parseRequestInfo(item.data.request_info);

    document.getElementById("ap-spot-name").value = item.data.request_title || "";
    document.getElementById("ap-title-name").value = parsed.title;
    document.getElementById("ap-spot-info").value = parsed.info;
    document.getElementById("ap-address").value = parsed.address;
    document.getElementById("ap-title-url").value = titleUrls[parsed.title] || "";

    // 何期の何話か：説明文から読み取れたら入れておく
    const episode = parseEpisode(parsed.info);
    document.getElementById("ap-season").value = episode.season || "";
    document.getElementById("ap-episode").value = episode.episode || "";

    document.getElementById("approve-error").hidden = true;
    ["ap-spot-name", "ap-title-name", "ap-spot-info", "ap-address"].forEach(function (id) {
        setFieldError(id, false);
    });

    document.getElementById("approve-modal").style.display = "flex";

    if (!approveMap) {
        approveMap = new mapboxgl.Map({
            container: "approve-map",
            style: "mapbox://styles/mapbox/streets-v12",
            center: [139.7671, 35.6812],
            zoom: 11
        });
        approveMap.on("click", function (event) {
            setApprovePosition(event.lngLat, false);
        });
    }
    if (approveMarker) {
        approveMarker.remove();
        approveMarker = null;
    }
    document.getElementById("ap-coord-text").textContent =
        "住所から位置を調べるか、地図をタップしてピンを置いてください。ピンはドラッグで動かせます。";
    setTimeout(function () { approveMap.resize(); }, 50);

    // 申請に住所があれば、すぐに位置を調べておく
    if (parsed.address) {
        geocodeAddress();
    }
}

window.closeApprove = function () {
    document.getElementById("approve-modal").style.display = "none";
    approving = null;
};

// 作品名を変えたら、既にある作品なら公式サイトを入れておく
document.getElementById("ap-title-name").addEventListener("change", function (event) {
    const url = titleUrls[event.target.value.trim()];
    const field = document.getElementById("ap-title-url");
    if (url && !field.value) field.value = url;
});

document.getElementById("ap-geocode").addEventListener("click", geocodeAddress);

document.getElementById("approve-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!approving) return;

    const spotName = document.getElementById("ap-spot-name").value.trim();
    const titleName = document.getElementById("ap-title-name").value.trim();
    const spotInfo = document.getElementById("ap-spot-info").value.trim();
    const titleUrl = document.getElementById("ap-title-url").value.trim();
    const season = readEpisodeNumber(document.getElementById("ap-season"), 99);
    const episode = readEpisodeNumber(document.getElementById("ap-episode"), 999);

    setFieldError("ap-spot-name", spotName === "");
    setFieldError("ap-title-name", titleName === "");
    setFieldError("ap-spot-info", spotInfo === "");
    setFieldError("ap-address", !approveMarker);

    const firstError = document.querySelector("#approve-form .form-group.has-error input, #approve-form .form-group.has-error textarea");
    if (firstError) {
        firstError.focus();
        return;
    }

    const lngLat = approveMarker.getLngLat();
    const button = document.getElementById("ap-submit");
    button.disabled = true;
    button.textContent = "追加中…";

    try {
        // 聖地の追加と、申請を「完了」にするのを同時に行う（片方だけ成功することがないように）
        const batch = writeBatch(db);
        const spotRef = doc(collection(db, "spot"));
        batch.set(spotRef, {
            spot_name: spotName,
            title_name: titleName,
            coord: new GeoPoint(lngLat.lat, lngLat.lng),
            image_url: "no_image",
            spot_info: spotInfo,
            title_url: titleUrl,
            geo_hash: encodeGeohash(lngLat.lat, lngLat.lng, 8),
            season: season,
            episode: episode
        });
        batch.update(doc(db, "request_spot", approving.id), { request_state: "完了" });
        addMessage(batch, approving.data.user_id, "聖地の登録申請が承認されました",
            "申請いただいた「" + spotName + "」（" + titleName + "）を地図に追加しました。\n" +
            "さっそくスタンプを集めに行ってみてください。ご協力ありがとうございました！");
        await batch.commit();

        approving.data.request_state = "完了";
        spots.push({ id: spotRef.id, data: { spot_name: spotName, title_name: titleName, spot_info: spotInfo, season: season, episode: episode } });
        renderEpisodes();
        if (titleUrl && !titleUrls[titleName]) titleUrls[titleName] = titleUrl;
        notify("「" + spotName + "」を地図に追加しました");
        window.closeApprove();
        render();
    } catch (error) {
        console.error(error);
        const box = document.getElementById("approve-error");
        box.textContent = error && error.code === "permission-denied"
            ? "追加する権限がありません。Firestore のルールと admin コレクションを確認してください。"
            : "追加できませんでした。通信状況を確認して、もう一度お試しください。";
        box.hidden = false;
    } finally {
        button.disabled = false;
        button.textContent = "許可して地図に追加する";
    }
});

// ---------- 何期の何話か ----------
// 入力欄の数字（空欄・0・数字でないものは 0 =「指定なし」）
function readEpisodeNumber(input, max) {
    const value = Math.floor(Number(input.value));
    return Number.isFinite(value) && value > 0 ? Math.min(value, max) : 0;
}

// 作品の選択肢
function renderEpisodeTitles() {
    const select = document.getElementById("episode-title");
    const current = select.value;
    const counts = {};
    spots.forEach(function (spot) {
        const title = spot.data.title_name || "その他";
        counts[title] = (counts[title] || 0) + 1;
    });

    select.innerHTML = "";
    Object.keys(counts).sort().forEach(function (title) {
        const option = document.createElement("option");
        option.value = title;
        option.textContent = title + "（" + counts[title] + "）";
        select.appendChild(option);
    });
    if (counts[current]) select.value = current;
}

// 保存ボタンに、保存していない変更の数を出す
function updateEpisodeSaveButton() {
    const changed = document.querySelectorAll("#episode-list .episode-item.is-changed").length;
    const button = document.getElementById("episode-save");
    button.disabled = changed === 0;
    button.textContent = changed === 0 ? "変更はありません" : "保存する（" + changed + "件）";
}

function renderEpisodes() {
    renderEpisodeTitles();

    const title = document.getElementById("episode-title").value;
    shownEpisodeTitle = title;
    const ul = document.getElementById("episode-list");
    ul.innerHTML = "";

    const list = spots.filter(function (spot) { return (spot.data.title_name || "その他") === title; });
    if (list.length === 0) {
        ul.appendChild(emptyItem("聖地がありません"));
        updateEpisodeSaveButton();
        return;
    }

    list.forEach(function (spot) {
        // まだ入力していない聖地は、説明文から読み取った値を推測として入れる
        const saved = "season" in spot.data || "episode" in spot.data;
        const guess = parseEpisode(spot.data.spot_info);
        const season = saved ? (spot.data.season || 0) : guess.season;
        const episode = saved ? (spot.data.episode || 0) : guess.episode;

        const li = document.createElement("li");
        li.className = "card episode-item";
        li.dataset.spotId = spot.id;

        const head = document.createElement("div");
        head.className = "episode-head";
        const name = document.createElement("h2");
        name.textContent = spot.data.spot_name || "（スポット名なし）";
        head.appendChild(name);
        if (!saved && (season || episode)) {
            const mark = document.createElement("span");
            mark.className = "guess-mark";
            mark.textContent = "推測";
            head.appendChild(mark);
        }

        const info = document.createElement("p");
        info.className = "episode-info";
        info.textContent = spot.data.spot_info || "";

        const inputs = document.createElement("div");
        inputs.className = "episode-inputs";
        [["season", "期", 99, season], ["episode", "話", 999, episode]].forEach(function (field) {
            const label = document.createElement("label");
            const input = document.createElement("input");
            input.type = "number";
            input.min = "0";
            input.max = String(field[2]);
            input.inputMode = "numeric";
            input.dataset.field = field[0];
            input.setAttribute("aria-label", (spot.data.spot_name || "") + "の" + field[1]);
            input.value = field[3] || "";
            input.addEventListener("input", function () {
                li.dataset.edited = "1";
                markChanged(li, spot);
            });
            label.append(input, " " + field[1]);
            inputs.appendChild(label);
        });

        li.append(head, info, inputs);
        ul.appendChild(li);
        markChanged(li, spot);
    });

    updateEpisodeSaveButton();
}

// 保存してある値と違う（または、まだ保存していない推測がある）なら「変更あり」
function readEpisodeInputs(li) {
    return {
        season: readEpisodeNumber(li.querySelector('[data-field="season"]'), 99),
        episode: readEpisodeNumber(li.querySelector('[data-field="episode"]'), 999)
    };
}

function markChanged(li, spot) {
    const value = readEpisodeInputs(li);
    const saved = "season" in spot.data || "episode" in spot.data;
    const changed = saved
        ? value.season !== (spot.data.season || 0) || value.episode !== (spot.data.episode || 0)
        : value.season !== 0 || value.episode !== 0;
    li.classList.toggle("is-changed", changed);
    updateEpisodeSaveButton();
}

// 入力した内容を保存せずに作品を切りかえようとしたら確かめる
let shownEpisodeTitle = "";
document.getElementById("episode-title").addEventListener("change", function (event) {
    const edited = document.querySelector('#episode-list .episode-item.is-changed[data-edited="1"]');
    if (edited && !window.confirm("保存していない入力があります。作品を切りかえますか？")) {
        event.target.value = shownEpisodeTitle;
        return;
    }
    renderEpisodes();
});

document.getElementById("episode-save").addEventListener("click", async function () {
    const button = this;
    const items = Array.from(document.querySelectorAll("#episode-list .episode-item.is-changed"));
    if (items.length === 0) return;

    button.disabled = true;
    button.textContent = "保存中…";

    try {
        const batch = writeBatch(db);
        const updates = items.map(function (li) {
            const value = readEpisodeInputs(li);
            batch.update(doc(db, "spot", li.dataset.spotId), value);
            return { id: li.dataset.spotId, value: value };
        });
        await batch.commit();

        updates.forEach(function (update) {
            const spot = spots.find(function (item) { return item.id === update.id; });
            if (spot) Object.assign(spot.data, update.value);
        });
        notify(updates.length + "件の聖地を保存しました");
        renderEpisodes();
    } catch (error) {
        console.error(error);
        notify(
            error && error.code === "permission-denied"
                ? "保存する権限がありません。Firestore のルールに season・episode を追加してください"
                : "保存できませんでした。通信状況を確認してください",
            "error"
        );
        updateEpisodeSaveButton();
    }
});

// ---------- タブ ----------
function selectTab(name) {
    ["requests", "contacts", "episodes"].forEach(function (key) {
        const selected = key === name;
        document.getElementById("tab-" + key).setAttribute("aria-selected", String(selected));
        document.getElementById("panel-" + key).hidden = !selected;
    });
    // 「対応済みも表示」は申請・お問い合わせの時だけ
    document.getElementById("show-done-label").hidden = name === "episodes";
}
document.getElementById("tab-requests").addEventListener("click", function () { selectTab("requests"); });
document.getElementById("tab-contacts").addEventListener("click", function () { selectTab("contacts"); });
document.getElementById("tab-episodes").addEventListener("click", function () { selectTab("episodes"); });
document.getElementById("show-done").addEventListener("change", render);

// ---------- 開いた時 ----------
(async function start() {
    const user = await getCurrentUser();
    if (!user) {
        showNotice("🔑", "管理ページを使うにはログインが必要です");
        const link = document.createElement("a");
        link.href = "login.html";
        link.className = "btn btn-primary";
        link.textContent = "ログインする";
        document.getElementById("admin-notice").appendChild(link);
        return;
    }

    // 自分が管理者か（admin/{uid} があるか）
    // 入れない時に原因が分かるよう、ルールで拒否されたのか、uid が無いのかを分けて表示する
    let isAdmin = false;
    try {
        isAdmin = (await getDoc(doc(db, "admin", user.uid))).exists();
    } catch (error) {
        console.error("admin の読み取りに失敗:", error);
        showNotice(
            "🚫",
            "管理者かどうかを確認できませんでした",
            error && error.code === "permission-denied"
                ? "Firestore のルールに match /admin/{uid}（自分の分だけ読める）を追加してください。あなたの uid：" + user.uid
                : "通信状況を確認して、開き直してください"
        );
        return;
    }
    if (!isAdmin) {
        showNotice(
            "🚫",
            "このページは管理者だけが使えます",
            "管理者にする場合は、Firestore の admin コレクションに、このIDのドキュメントを作ってください：" + user.uid
        );
        return;
    }

    try {
        await loadAll();
    } catch (error) {
        console.error(error);
        showNotice("⚠️", "読み込めませんでした", "Firestore のルールで管理者の読み取りが許可されているか確認してください");
        return;
    }

    document.getElementById("admin-notice").hidden = true;
    document.getElementById("admin-main").hidden = false;
    render();
    renderEpisodes();
})();

// 色の確認用（作品名の入力欄の横に作品の色を出す）
document.getElementById("ap-title-name").addEventListener("input", function (event) {
    event.target.style.borderLeft = "6px solid " + getTitleColor(event.target.value.trim() || "その他");
});

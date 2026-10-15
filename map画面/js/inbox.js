// ==========================================
// お知らせ（メールボックス）
// 運営からの返信・申請結果が message コレクションに届く（自分宛てのものだけ読める）
// 開いたものは既読（is_read: true）にする
// ==========================================
import {
    collection,
    doc,
    getDocs,
    query,
    updateDoc,
    where
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

import { db, getCurrentUser } from "./firebase-db.js";

function showNotice(icon, text, link) {
    const notice = document.getElementById("inbox-notice");
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
    document.getElementById("inbox-list").hidden = true;
}

function formatDateTime(timestamp) {
    if (!timestamp || typeof timestamp.toDate !== "function") return "";
    const d = timestamp.toDate();
    return d.getFullYear() + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" +
        String(d.getDate()).padStart(2, "0") + " " +
        String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

// 開いた時に既読にする（失敗しても表示はそのまま）
async function markRead(message, item) {
    if (message.data.is_read) return;
    message.data.is_read = true;
    item.classList.remove("is-unread");
    try {
        await updateDoc(doc(db, "message", message.id), { is_read: true });
    } catch (error) {
        console.warn("既読にできませんでした:", error);
    }
}

function render(messages) {
    const list = document.getElementById("inbox-list");
    list.innerHTML = "";

    messages.forEach(function (message) {
        const li = document.createElement("li");
        li.className = "card inbox-item" + (message.data.is_read ? "" : " is-unread");

        // 押すと本文が開く（details 要素なのでキーボードでも開ける）
        const details = document.createElement("details");
        const summary = document.createElement("summary");

        const dot = document.createElement("span");
        dot.className = "unread-dot";
        dot.setAttribute("aria-hidden", "true");

        const title = document.createElement("span");
        title.className = "inbox-title";
        title.textContent = message.data.title || "お知らせ";

        const date = document.createElement("span");
        date.className = "inbox-date";
        date.textContent = formatDateTime(message.data.created_at);

        summary.append(dot, title, date);
        if (!message.data.is_read) {
            const label = document.createElement("span");
            label.className = "visually-hidden";
            label.textContent = "（未読）";
            summary.appendChild(label);
        }

        const body = document.createElement("p");
        body.className = "inbox-body";
        body.textContent = message.data.body || "";

        details.append(summary, body);
        details.addEventListener("toggle", function () {
            if (details.open) markRead(message, li);
        });

        li.appendChild(details);
        list.appendChild(li);
    });

    document.getElementById("inbox-notice").hidden = true;
    list.hidden = false;
}

(async function start() {
    const user = await getCurrentUser();
    if (!user) {
        showNotice("🔑", "お知らせを見るにはログインが必要です", { href: "login.html", text: "ログインする" });
        return;
    }

    try {
        const snapshot = await getDocs(query(
            collection(db, "message"),
            where("user_id", "==", doc(db, "user", user.uid))
        ));

        const messages = [];
        snapshot.forEach(function (d) {
            messages.push({ id: d.id, data: d.data() });
        });

        // 新しい順
        messages.sort(function (a, b) {
            const ta = a.data.created_at && a.data.created_at.toMillis ? a.data.created_at.toMillis() : 0;
            const tb = b.data.created_at && b.data.created_at.toMillis ? b.data.created_at.toMillis() : 0;
            return tb - ta;
        });

        if (messages.length === 0) {
            showNotice("📭", "お知らせはまだありません");
            return;
        }
        render(messages);
    } catch (error) {
        console.error("お知らせの読み込みに失敗しました:", error);
        showNotice("⚠️", "お知らせを読み込めませんでした。通信状況を確認して、開き直してください。");
    }
})();

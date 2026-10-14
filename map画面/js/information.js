// ========================================
// お問い合わせ（contact に送る。運営が確認して、必要なら返信する）
// ========================================
import { getWaitSeconds, sendContact } from "./request-db.js";

const MESSAGE_LIMIT = 2000;

function showContactError(message) {
    const box = document.getElementById("contact-error");
    box.textContent = message;
    box.hidden = !message;
}

async function submitContact() {
    const message = document.getElementById("contactText").value.trim();
    const replyTo = document.getElementById("replyTo").value.trim();

    // 内容が空・長すぎる時、返信先の形がおかしい時は送信しない
    const messageError = message === "" || message.length > MESSAGE_LIMIT;
    const replyError = replyTo !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo);
    setFieldError("contactText", messageError);
    setFieldError("replyTo", replyError);
    showContactError("");

    if (messageError || replyError) {
        document.getElementById(messageError ? "contactText" : "replyTo").focus();
        return;
    }

    const wait = getWaitSeconds("contact");
    if (wait > 0) {
        showContactError("続けて送信することはできません。" + wait + "秒ほど待ってからもう一度お試しください。");
        return;
    }

    const button = document.getElementById("contact-btn");
    button.disabled = true;
    button.textContent = "送信中…";

    try {
        await sendContact({ message: message, replyTo: replyTo });
    } catch (error) {
        console.error("お問い合わせの送信に失敗しました:", error);
        showContactError("送信できませんでした。通信状況を確認して、もう一度お試しください。");
        button.disabled = false;
        button.textContent = "送信する";
        return;
    }

    document.getElementById("formPage").style.display = "none";
    document.getElementById("completePage").style.display = "block";
    window.scrollTo(0, 0);
}

document.getElementById("contact-form").addEventListener("submit", function (event) {
    event.preventDefault();
    submitContact();
});

// ログイン中なら、登録したメールアドレスを返信先に入れておく
(function fillReplyTo() {
    try {
        const account = JSON.parse(localStorage.getItem("seitiAccount") || "null");
        if (account && account.email) {
            document.getElementById("replyTo").value = account.email;
        }
    } catch (e) {
        // 読めない時は空のまま
    }
})();

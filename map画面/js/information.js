// ========================================
// お問い合わせ（contact に送る。運営が確認して、必要なら登録したメールアドレスへ返信する）
// ========================================
import { getLoginUserId, getWaitSeconds, sendContact } from "./request-db.js";

const MESSAGE_LIMIT = 2000;

function showContactError(message) {
    const box = document.getElementById("contact-error");
    box.textContent = message;
    box.hidden = !message;
}

async function submitContact() {
    const message = document.getElementById("contactText").value.trim();

    // 内容が空・長すぎる時は送信しない
    const messageError = message === "" || message.length > MESSAGE_LIMIT;
    setFieldError("contactText", messageError);
    showContactError("");

    if (messageError) {
        document.getElementById("contactText").focus();
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
        await sendContact({ message: message });
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

// お問い合わせはログインした人だけ（返信先は登録したメールアドレス）
getLoginUserId().then(function (userId) {
    if (!userId) {
        document.getElementById("contact-form").hidden = true;
        document.getElementById("contact-login").hidden = false;
    }
});

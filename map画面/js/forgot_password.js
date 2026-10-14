// ==========================================
// パスワード再発行（Firebase Authentication が再設定メールを送る）
// ==========================================
import {
    sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

import { auth } from "./firebase-db.js";
import { authErrorMessage } from "./login-state.js";

// メールの文面を日本語にする
auth.languageCode = "ja";

// ログイン画面に戻る
window.goToLogin = function () {
    window.location.href = "login.html";
};

function showReissueError(message) {
    const box = document.getElementById("reissue-error");
    box.textContent = message;
    box.hidden = !message;
}

// パスワード再発行ボタンを押したときの処理
async function submitReissue() {
    const email = document.getElementById("email").value.trim();
    const emailError = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    setFieldError("email", emailError);
    showReissueError("");

    if (emailError) {
        document.getElementById("email").focus();
        return;
    }

    const button = document.getElementById("reissue-btn");
    button.disabled = true;
    button.textContent = "送信中…";

    try {
        await sendPasswordResetEmail(auth, email);
    } catch (error) {
        // 登録されていないアドレスでも、他人に知られないよう「送信しました」と表示する
        if (error && error.code !== "auth/user-not-found") {
            console.error("再設定メールの送信に失敗:", error);
            showReissueError(authErrorMessage(error));
            button.disabled = false;
            button.textContent = "再発行メールを送る";
            return;
        }
    }

    document.getElementById("completion-modal").style.display = "flex";
}

document.getElementById("reissue-form").addEventListener("submit", function (event) {
    event.preventDefault();
    submitReissue();
});

// ポップアップのボタンを押したときの処理（閉じた後はログイン画面に戻す）
window.closeModal = function () {
    document.getElementById("completion-modal").style.display = "none";
    window.location.href = "login.html";
};

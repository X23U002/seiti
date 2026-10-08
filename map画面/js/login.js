// ==========================================
// ログイン画面
// ==========================================
import {
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

import { db } from "./firebase-db.js";
import { saveLoginState } from "./login-state.js";

// 「ユーザーIDを保存する」で使う保存先
const SAVED_ID_KEY = "seitiSavedUserId";

// フォームの上にエラーメッセージを表示する（空文字で消す）
function showLoginError(message) {
    const box = document.getElementById("login-error");
    box.textContent = message;
    box.hidden = !message;
}

// ログインボタンを押した時の処理
async function login() {
    const userId = document.getElementById("userid").value.trim();
    const password = document.getElementById("password").value;

    // 入力チェック（エラーは各項目の下に表示）
    setFieldError("userid", userId === "");
    setFieldError("password", password === "");
    showLoginError("");

    const firstError = document.querySelector(".form-group.has-error input");
    if (firstError) {
        firstError.focus();
        return;
    }

    // 連打で何度も問い合わせないよう、終わるまでボタンを押せなくする
    const button = document.querySelector(".btn-login");
    button.disabled = true;
    button.textContent = "ログイン中…";

    try {
        // userコレクションのドキュメントIDを直接参照
        const userSnap = await getDoc(doc(db, "user", userId));

        if (!userSnap.exists()) {
            showLoginError("ユーザーIDが存在しません。");
            document.getElementById("userid").focus();
            return;
        }

        const userData = userSnap.data();

        if (userData.pass !== password) {
            showLoginError("パスワードが違います。");
            document.getElementById("password").focus();
            return;
        }

        // 「ユーザーIDを保存する」にチェックがあれば次回のために保存する
        try {
            if (document.getElementById("remember-id").checked) {
                localStorage.setItem(SAVED_ID_KEY, userId);
            } else {
                localStorage.removeItem(SAVED_ID_KEY);
            }
        } catch (e) {
            // 保存できない環境では何もしない
        }

        saveLoginState(userId, userData.user_name, userData.mail_address, userData.icon_image_url);

        window.location.href = "map.html";
    } catch (error) {
        console.error("ログインエラー:", error);
        showLoginError("ログインに失敗しました。通信状況を確認して、もう一度お試しください。");
    } finally {
        button.disabled = false;
        button.textContent = "ログイン";
    }
}

document.getElementById("login-form").addEventListener("submit", function (event) {
    event.preventDefault();
    login();
});

// 保存しておいたユーザーIDがあれば入力しておく
(function restoreUserId() {
    let savedId = null;
    try {
        savedId = localStorage.getItem(SAVED_ID_KEY);
    } catch (e) {
        savedId = null;
    }

    if (savedId) {
        document.getElementById("userid").value = savedId;
        document.getElementById("remember-id").checked = true;
        document.getElementById("password").focus();
    }
})();

// ==========================================
// ログイン画面（Firebase Authentication のメールアドレス・パスワードでログイン）
// ==========================================
import {
    signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

import {
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

import { auth, db } from "./firebase-db.js";
import { authErrorMessage, saveLoginState } from "./login-state.js";

// 「メールアドレスを保存する」で使う保存先
const SAVED_EMAIL_KEY = "seitiSavedEmail";

// フォームの上にエラーメッセージを表示する（空文字で消す）
function showLoginError(message) {
    const box = document.getElementById("login-error");
    box.textContent = message;
    box.hidden = !message;
}

// ログインボタンを押した時の処理
async function login() {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    // 入力チェック（エラーは各項目の下に表示）
    setFieldError("email", !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
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
        const credential = await signInWithEmailAndPassword(auth, email, password);
        const uid = credential.user.uid;

        // ニックネームは user/{uid} に保存してある（無ければメールアドレスの@より前を仮の名前にする）
        let nickname = email.split("@")[0];
        try {
            const userSnap = await getDoc(doc(db, "user", uid));
            if (userSnap.exists() && userSnap.data().user_name) {
                nickname = userSnap.data().user_name;
            }
        } catch (error) {
            console.warn("ニックネームを読み込めませんでした:", error);
        }

        // 「メールアドレスを保存する」にチェックがあれば次回のために保存する
        try {
            if (document.getElementById("remember-id").checked) {
                localStorage.setItem(SAVED_EMAIL_KEY, email);
            } else {
                localStorage.removeItem(SAVED_EMAIL_KEY);
            }
        } catch (e) {
            // 保存できない環境では何もしない
        }

        saveLoginState(uid, nickname, email);

        window.location.href = "map.html";
    } catch (error) {
        console.error("ログインエラー:", error);
        showLoginError(authErrorMessage(error));
        button.disabled = false;
        button.textContent = "ログイン";
    }
}

document.getElementById("login-form").addEventListener("submit", function (event) {
    event.preventDefault();
    login();
});

// 保存しておいたメールアドレスがあれば入力しておく
(function restoreEmail() {
    let savedEmail = null;
    try {
        savedEmail = localStorage.getItem(SAVED_EMAIL_KEY);
    } catch (e) {
        savedEmail = null;
    }

    if (savedEmail) {
        document.getElementById("email").value = savedEmail;
        document.getElementById("remember-id").checked = true;
        document.getElementById("password").focus();
    }
})();

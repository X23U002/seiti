// ==========================================
// 登録確認画面
// ==========================================
import {
    createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

import {
    doc,
    setDoc
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

import { auth, db } from "./firebase-db.js";
import { authErrorMessage, saveLoginState } from "./login-state.js";

// 新規登録入力画面に戻る
window.goToRegister = function () {
    window.location.href = "newaccount.html";
};

// マップ画面へ
window.goToMap = function () {
    window.location.href = "map.html";
};

// 新規登録画面で入力した内容
function readNewAccount() {
    return JSON.parse(sessionStorage.getItem("newAccount") || "null");
}

// 「登録する」ボタンの上にエラーメッセージを表示する（空文字で消す）
function showConfirmError(message) {
    const box = document.getElementById("confirm-error");
    box.textContent = message;
    box.hidden = !message;
}

// 登録完了処理
window.goToComplete = async function () {
    const saved = readNewAccount();

    if (!saved || !saved.password) {
        showConfirmError("登録情報がありません。「入力内容を修正する」からもう一度入力してください。");
        return;
    }

    // 連打で二重に登録しないよう、終わるまでボタンを押せなくする
    const button = document.getElementById("register-btn");
    button.disabled = true;
    button.textContent = "登録中…";
    showConfirmError("");

    let uid;

    try {
        // アカウントを作る（パスワードは Firebase が管理し、DBには保存しない）
        const credential = await createUserWithEmailAndPassword(auth, saved.email, saved.password);
        uid = credential.user.uid;
    } catch (error) {
        console.error("登録エラー:", error);
        showConfirmError(authErrorMessage(error));
        button.disabled = false;
        button.textContent = "登録する";
        return;
    }

    // ニックネームなどを user/{uid} に保存する
    // （失敗してもアカウントはできているので、ログイン時に仮の名前で続けられる）
    try {
        await setDoc(doc(db, "user", uid), {
            user_name: saved.nickname,
            mail_address: saved.email,
            icon_image_url: "no_image"
        });
    } catch (error) {
        console.error("ユーザー情報の保存に失敗:", error);
    }

    // ここから先は登録済み。失敗しても「登録に失敗」とは表示しない
    // （もう一度押されると同じ人が二重に登録されてしまうため）
    sessionStorage.removeItem("newAccount");

    // 登録したらそのままログインした状態にする
    try {
        saveLoginState(uid, saved.nickname, saved.email);
    } catch (error) {
        console.error("ログイン状態の保存に失敗:", error);
    }

    // 完了ポップアップ表示（ログインに使うメールアドレスを知らせる）
    button.textContent = "登録しました";
    document.getElementById("created-user-id").textContent = saved.email;
    document.getElementById("complete-modal").style.display = "flex";
};

// 新規登録画面で入力した内容を表示する
(function showInput() {
    const saved = readNewAccount();
    if (!saved) return;
    document.getElementById("confirm-nickname").textContent = saved.nickname || "-";
    document.getElementById("confirm-email").textContent = saved.email;
    document.getElementById("confirm-password").textContent = "•".repeat((saved.password || "").length) + "（非表示）";
})();

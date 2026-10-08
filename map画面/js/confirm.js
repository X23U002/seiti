// ==========================================
// 登録確認画面
// ==========================================
import {
    doc,
    runTransaction
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

import { db } from "./firebase-db.js";
import { saveLoginState } from "./login-state.js";

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

    let userId;

    try {
        const countRef = doc(db, "count", "user");

        // 連番の取得・ユーザー作成・連番の更新を1回の処理で行い、
        // 同時に登録した人がいてもIDが重ならないようにする
        userId = await runTransaction(db, async function (transaction) {
            const countSnap = await transaction.get(countRef);

            if (!countSnap.exists()) {
                throw new Error("カウンタ情報がありません");
            }

            const nextId = countSnap.data().next_id;
            const newUserId = `u${nextId}`;
            const userRef = doc(db, "user", newUserId);

            // 既にあるユーザーを上書きしないようにする
            const userSnap = await transaction.get(userRef);
            if (userSnap.exists()) {
                throw new Error(`${newUserId} は既に使われています`);
            }

            transaction.set(userRef, {
                user_name: saved.nickname,
                pass: saved.password,
                mail_address: saved.email,
                icon_image_url: "no_image"
            });

            transaction.update(countRef, {
                next_id: nextId + 1
            });

            return newUserId;
        });
    } catch (error) {
        console.error("登録エラー:", error);
        showConfirmError("登録に失敗しました。通信状況を確認して、もう一度お試しください。");
        button.disabled = false;
        button.textContent = "登録する";
        return;
    }

    // ここから先は登録済み。失敗しても「登録に失敗」とは表示しない
    // （もう一度押されると同じ人が二重に登録されてしまうため）
    sessionStorage.removeItem("newAccount");

    // 登録したらそのままログインした状態にする
    try {
        saveLoginState(userId, saved.nickname, saved.email, "no_image");
    } catch (error) {
        console.error("ログイン状態の保存に失敗:", error);
    }

    // 完了ポップアップ表示（ログインに使うユーザーIDを知らせる）
    button.textContent = "登録しました";
    document.getElementById("created-user-id").textContent = userId;
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

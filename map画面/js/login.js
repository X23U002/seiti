// ==========================================
// ログイン画面
// ==========================================

// 「ユーザーIDを保存する」で使う保存先
const SAVED_ID_KEY = "seitiSavedUserId";

// ログインボタンを押した時の処理
function login() {
    const userId = document.getElementById("userid").value.trim();
    const password = document.getElementById("password").value;

    // 入力チェック（エラーは各項目の下に表示）
    setFieldError("userid", userId === "");
    setFieldError("password", password === "");

    const firstError = document.querySelector(".form-group.has-error input");
    if (firstError) {
        firstError.focus();
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

    // 今はプロトタイプなので、入力があればそのままマップ画面へ移動する
    window.location.href = "map.html";
}

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

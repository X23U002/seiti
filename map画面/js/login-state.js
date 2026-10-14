// ==========================================
// ログイン状態の保存・削除と、ログインのエラーを日本語にする
// （ログインそのものは Firebase Authentication が管理する。
//   ここに保存するのは、画面にすぐ名前などを出すための控え）
// ==========================================

// ログイン・新規登録の完了時に呼ぶ
export function saveLoginState(uid, nickname, email) {
    sessionStorage.setItem("userId", uid);
    sessionStorage.setItem("userName", nickname);
    sessionStorage.setItem("mailAddress", email);

    // マイページで使う情報（アイコンの絵文字は端末ごとの設定を引き継ぐ）
    try {
        const profile = JSON.parse(localStorage.getItem("seitiProfile") || "null") || {};
        localStorage.setItem("seitiProfile", JSON.stringify({
            name: nickname,
            icon: profile.icon || "👤"
        }));
        localStorage.setItem("seitiAccount", JSON.stringify({
            nickname: nickname,
            email: email
        }));
        localStorage.setItem("seitiCurrentUserId", uid);
    } catch (e) {
        // 保存できない環境では何もしない
    }
}

// ログアウトの時に呼ぶ
export function clearLoginState() {
    ["userId", "userName", "mailAddress", "iconImageUrl"].forEach(function (key) {
        sessionStorage.removeItem(key);
    });
    try {
        localStorage.removeItem("seitiCurrentUserId");
        localStorage.removeItem("seitiAccount");
    } catch (e) {
        // 保存できない環境では何もしない
    }
}

// Firebase Authentication のエラーを、画面に出す文に直す
export function authErrorMessage(error) {
    switch (error && error.code) {
        case "auth/invalid-credential":
        case "auth/wrong-password":
        case "auth/user-not-found":
            return "メールアドレスまたはパスワードが違います。";
        case "auth/invalid-email":
            return "メールアドレスの形式が正しくありません。";
        case "auth/email-already-in-use":
            return "このメールアドレスは既に登録されています。ログイン画面からログインしてください。";
        case "auth/weak-password":
            return "パスワードが短すぎます。英数字8文字以上にしてください。";
        case "auth/too-many-requests":
            return "何度も失敗したため、しばらく操作できません。時間をおいてもう一度お試しください。";
        case "auth/user-disabled":
            return "このアカウントは利用できません。お問い合わせください。";
        case "auth/network-request-failed":
            return "通信できませんでした。通信状況を確認して、もう一度お試しください。";
        default:
            return "うまくいきませんでした。時間をおいてもう一度お試しください。";
    }
}

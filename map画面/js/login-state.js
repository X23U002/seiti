// ==========================================
// ログイン状態を保存（ログイン・新規登録の完了時に呼ぶ）
// ==========================================
export function saveLoginState(userId, nickname, email, iconImageUrl) {
    sessionStorage.setItem("userId", userId);
    sessionStorage.setItem("userName", nickname);
    sessionStorage.setItem("mailAddress", email);
    sessionStorage.setItem("iconImageUrl", iconImageUrl);

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
        localStorage.setItem("seitiCurrentUserId", userId);
    } catch (e) {
        // 保存できない環境では何もしない
    }
}

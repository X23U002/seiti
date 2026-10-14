// ========================================
// 聖地登録（申請を request_spot に送る。運営が確認してから地図に追加する）
// ========================================
import { getLoginUserId, getWaitSeconds, sendSpotRequest } from "./request-db.js";

// 入力の上限（DBのルールと同じ）
const LIMITS = { animeName: 100, spotName: 100, address: 200, spotText: 1000 };

function showRegisterError(message) {
    const box = document.getElementById("register-error");
    box.textContent = message;
    box.hidden = !message;
}

async function completeRegister() {
    // 入力内容取得
    const values = {};
    Object.keys(LIMITS).forEach(function (id) {
        values[id] = document.getElementById(id).value.trim();
        // 入力チェック（エラーは各項目の下に表示）
        setFieldError(id, values[id] === "" || values[id].length > LIMITS[id]);
    });
    showRegisterError("");

    const firstError = document.querySelector(".form-group.has-error input, .form-group.has-error textarea");
    if (firstError) {
        firstError.focus();
        return;
    }

    const wait = getWaitSeconds("request_spot");
    if (wait > 0) {
        showRegisterError("続けて申請することはできません。" + wait + "秒ほど待ってからもう一度お試しください。");
        return;
    }

    // 連打で何件も申請しないよう、終わるまでボタンを押せなくする
    const button = document.getElementById("register-btn");
    button.disabled = true;
    button.textContent = "送信中…";

    try {
        await sendSpotRequest({
            titleName: values.animeName,
            spotName: values.spotName,
            address: values.address,
            spotInfo: values.spotText
        });
    } catch (error) {
        console.error("聖地登録の申請に失敗しました:", error);
        showRegisterError("送信できませんでした。通信状況を確認して、もう一度お試しください。");
        button.disabled = false;
        button.textContent = "聖地登録を申請する";
        return;
    }

    // 登録画面を非表示にして完了画面を表示
    document.getElementById("registerPage").style.display = "none";
    document.getElementById("completePage").style.display = "block";
    window.scrollTo(0, 0);
}

document.getElementById("register-form").addEventListener("submit", function (event) {
    event.preventDefault();
    completeRegister();
});

// 申請はログインした人だけ（いたずらの申請を減らすため）
getLoginUserId().then(function (userId) {
    if (!userId) {
        document.getElementById("register-form").hidden = true;
        document.getElementById("register-login").hidden = false;
    }
});

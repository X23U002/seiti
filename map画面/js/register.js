// ========================================
// 聖地登録（申請を request_spot に送る。運営が確認してから地図に追加する）
// 入力は管理ページの「聖地として地図に追加」とそろえている（作品名・スポット名・説明・期・話・場所）
// ========================================
import { getLoginUserId, getWaitSeconds, sendSpotRequest } from "./request-db.js?v=2";
import { createPinPicker } from "./pin-picker.js";
import { getTitleName } from "./title-colors.js";
import { readCachedSpots } from "./public-data.js";

// 入力の上限（DBのルールと同じ）
const LIMITS = { animeName: 100, spotName: 100, spotText: 1000 };

const picker = createPinPicker({
    container: "pin-map",
    text: document.getElementById("coord-text"),
    onChange: function () {
        setFieldError("address", false);
    }
});

function showRegisterError(message) {
    const box = document.getElementById("register-error");
    box.textContent = message;
    box.hidden = !message;
}

// 期・話（空欄・0・数字でないものは 0 =「指定なし」）
function readNumber(id, max) {
    const value = Math.floor(Number(document.getElementById(id).value));
    return Number.isFinite(value) && value > 0 ? Math.min(value, max) : 0;
}

// 住所から位置を調べる
document.getElementById("geocode-btn").addEventListener("click", async function () {
    const address = document.getElementById("address").value.trim();
    if (!address) {
        document.getElementById("address").focus();
        return;
    }

    const button = this;
    button.disabled = true;
    try {
        const found = await picker.geocode(address);
        if (!found) {
            showRegisterError("住所から位置が見つかりませんでした。地図をタップしてピンを置いてください。");
        } else {
            showRegisterError("");
        }
    } catch (error) {
        console.error(error);
        showRegisterError("位置を調べられませんでした。地図をタップしてピンを置いてください。");
    } finally {
        button.disabled = false;
    }
});

async function completeRegister() {
    // 入力内容取得
    const values = {};
    Object.keys(LIMITS).forEach(function (id) {
        values[id] = document.getElementById(id).value.trim();
        // 入力チェック（エラーは各項目の下に表示）
        setFieldError(id, values[id] === "" || values[id].length > LIMITS[id]);
    });
    values.address = document.getElementById("address").value.trim();

    // 場所は、住所かピンのどちらかがあればよい
    const position = picker.getPosition();
    setFieldError("address", !position && values.address === "");
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
            spotInfo: values.spotText,
            season: readNumber("season", 99),
            episode: readNumber("episode", 999),
            position: position
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

// 既にある作品を、作品名の候補に出す（地図で前に読み込んだ聖地から）
(function fillTitleOptions() {
    const spots = readCachedSpots() || [];
    const titles = [...new Set(spots.map(getTitleName))].sort(function (a, b) {
        return a.localeCompare(b, "ja");
    });
    const datalist = document.getElementById("title-options");
    titles.forEach(function (title) {
        const option = document.createElement("option");
        option.value = title;
        datalist.appendChild(option);
    });
})();

// 申請はログインした人だけ（いたずらの申請を減らすため）
getLoginUserId().then(function (userId) {
    if (!userId) {
        document.getElementById("register-form").hidden = true;
        document.getElementById("register-login").hidden = false;
    } else {
        picker.resize();
    }
});

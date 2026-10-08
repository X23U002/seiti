// ==========================================
// 全画面共通の UI 処理
// ==========================================

// ------------------------------------------
// モーダル：背景クリック・Escキーで閉じる
// （各モーダル内の data-modal-close を持つボタンを押したのと同じ動きにする）
// ------------------------------------------
function closeVisibleModal(overlay) {
    const closer = overlay.querySelector("[data-modal-close]");
    if (closer) {
        closer.click();
    }
}

document.addEventListener("click", function (event) {
    if (event.target.classList && event.target.classList.contains("modal-overlay")) {
        closeVisibleModal(event.target);
    }
});

document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    document.querySelectorAll(".modal-overlay").forEach(function (overlay) {
        if (overlay.style.display !== "none") {
            closeVisibleModal(overlay);
        }
    });
});

// ------------------------------------------
// パスワードの表示／非表示切り替え
// <button class="password-toggle" data-target="password">
// ------------------------------------------
document.querySelectorAll(".password-toggle").forEach(function (button) {
    button.addEventListener("click", function () {
        const input = document.getElementById(button.dataset.target);
        if (!input) return;
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        button.textContent = show ? "隠す" : "表示";
        button.setAttribute("aria-pressed", String(show));
    });
});

// ------------------------------------------
// ファイル選択：選んだファイル名とプレビューを表示
// <label class="file-input"> の中に input[type=file] と .file-input-text を置く
// ------------------------------------------
document.querySelectorAll(".file-input input[type='file']").forEach(function (input) {
    const wrapper = input.closest(".file-input");
    const text = wrapper.querySelector(".file-input-text");
    const preview = document.getElementById(input.dataset.preview);
    const defaultText = text ? text.textContent : "";

    input.addEventListener("change", function () {
        const file = input.files[0];
        wrapper.classList.toggle("has-file", Boolean(file));
        if (text) {
            text.textContent = file ? file.name : defaultText;
        }
        if (!preview) return;
        if (file && file.type.startsWith("image/")) {
            preview.src = URL.createObjectURL(file);
            preview.classList.add("show");
        } else {
            preview.removeAttribute("src");
            preview.classList.remove("show");
        }
    });
});

// ------------------------------------------
// 入力エラー表示（alertの代わりに項目の下に表示する）
// ------------------------------------------
function setFieldError(inputId, hasError) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const group = input.closest(".form-group");
    if (group) {
        group.classList.toggle("has-error", hasError);
    }
    input.setAttribute("aria-invalid", String(hasError));
}

// ------------------------------------------
// ログイン状態を保存（ログイン・新規登録の完了時に呼ぶ）
// ------------------------------------------
function saveLoginState(userId, nickname, email, iconImageUrl) {
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

// 入力し直したらエラー表示を消す
document.addEventListener("input", function (event) {
    const group = event.target.closest && event.target.closest(".form-group.has-error");
    if (group) {
        group.classList.remove("has-error");
        event.target.setAttribute("aria-invalid", "false");
    }
});

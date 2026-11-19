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

// 入力し直したらエラー表示を消す
document.addEventListener("input", function (event) {
    const group = event.target.closest && event.target.closest(".form-group.has-error");
    if (group) {
        group.classList.remove("has-error");
        event.target.setAttribute("aria-invalid", "false");
    }
});

// ------------------------------------------
// 数字を 0（または今の数）から目標の数までカウントアップして出す
// （スタンプの数・進み具合など。動きを減らす設定の人には、すぐ目標の数を出す）
// ------------------------------------------
function countUp(element, to, duration) {
    if (!element) return;
    const target = Number(to) || 0;
    const from = Number(element.dataset.countValue || element.textContent) || 0;
    element.dataset.countValue = String(target);

    cancelAnimationFrame(Number(element.dataset.countFrame) || 0);

    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || from === target) {
        element.textContent = String(target);
        return;
    }

    const time = duration || Math.min(1200, 400 + Math.abs(target - from) * 40);
    const start = performance.now();
    const frame = function (now) {
        const progress = Math.min(1, (now - start) / time);
        const eased = 1 - Math.pow(1 - progress, 3);
        element.textContent = String(Math.round(from + (target - from) * eased));
        if (progress < 1) {
            element.dataset.countFrame = String(requestAnimationFrame(frame));
        }
    };
    element.dataset.countFrame = String(requestAnimationFrame(frame));
}

window.countUp = countUp;

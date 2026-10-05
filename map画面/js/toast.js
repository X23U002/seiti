// ==========================================
// 画面下に短いメッセージを表示する（alertの代わり）
// showToast("ルートに追加しました")
// showToast("見つかりませんでした", "error")
// ==========================================
(function () {
    let hideTimer = null;

    window.showToast = function (message, type) {
        let toast = document.getElementById("toast");

        if (!toast) {
            toast = document.createElement("div");
            toast.id = "toast";
            toast.setAttribute("role", "status");
            toast.setAttribute("aria-live", "polite");
            document.body.appendChild(toast);
        }

        toast.textContent = message;
        toast.className = type === "error" ? "toast-error" : "";

        // 一度消してから表示し直すことで、連続しても毎回アニメーションさせる
        toast.classList.remove("show");
        void toast.offsetWidth;
        toast.classList.add("show");

        clearTimeout(hideTimer);
        hideTimer = setTimeout(function () {
            toast.classList.remove("show");
        }, 2800);
    };
})();

// ==========================================
// 画面下に短いメッセージを表示する（alertの代わり）
// showToast("ルートに追加しました")
// showToast("見つかりませんでした", "error")
// ボタンを付ける時（元に戻す・ログインする など）：
// showToast("全削除しました", "", { label: "元に戻す", onClick: function () { ... } })
// showToast("ログインすると使えます", "", { label: "ログインする", href: "login.html" })
// ==========================================
(function () {
    let hideTimer = null;

    window.showToast = function (message, type, action) {
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

        if (action && action.label) {
            const button = document.createElement(action.href ? "a" : "button");
            button.className = "toast-action";
            button.textContent = action.label;
            if (action.href) {
                button.href = action.href;
            } else {
                button.type = "button";
                button.addEventListener("click", function () {
                    toast.classList.remove("show");
                    clearTimeout(hideTimer);
                    action.onClick();
                });
            }
            toast.append(" ", button);
            toast.classList.add("has-action");
        }

        // 一度消してから表示し直すことで、連続しても毎回アニメーションさせる
        toast.classList.remove("show");
        void toast.offsetWidth;
        toast.classList.add("show");

        // ボタンがある時は、押せるように長めに出す
        clearTimeout(hideTimer);
        hideTimer = setTimeout(function () {
            toast.classList.remove("show");
        }, action && action.label ? 6000 : 2800);
    };
})();

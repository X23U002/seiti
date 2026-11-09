// ==========================================
// アプリとして使えるようにする（ホーム画面に追加・オフライン）
// ・service worker（../sw.js）を登録して、電波が弱い所でも開けるようにする
// ・「ホーム画面に追加」を押された時に、追加の案内を出す（window.installApp）
// ・圏外になったら知らせる
// ==========================================
(function () {
    if ("serviceWorker" in navigator) {
        window.addEventListener("load", function () {
            navigator.serviceWorker.register("../sw.js?v=f6cc6be3", { scope: "../" }).catch(function (error) {
                console.warn("オフライン用の準備ができませんでした:", error);
            });
        });
    }

    // Android の Chrome などは、追加の案内を後から出せる
    let installPrompt = null;
    window.addEventListener("beforeinstallprompt", function (event) {
        event.preventDefault();
        installPrompt = event;
    });

    function notify(message) {
        if (typeof window.showToast === "function") {
            window.showToast(message);
        } else {
            window.alert(message);
        }
    }

    window.installApp = function () {
        const standalone =
            window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
        if (standalone) {
            notify("すでにホーム画面から開いています");
            return;
        }
        if (installPrompt) {
            installPrompt.prompt();
            installPrompt.userChoice.finally(function () { installPrompt = null; });
            return;
        }
        if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
            notify("Safari の共有ボタン（□に↑）から「ホーム画面に追加」を選んでください");
            return;
        }
        notify("ブラウザのメニューから「ホーム画面に追加」（アプリをインストール）を選んでください");
    };

    window.addEventListener("offline", function () {
        notify("通信できません。前に見た聖地とページは、そのまま使えます");
    });
    window.addEventListener("online", function () {
        notify("通信できるようになりました");
    });
})();

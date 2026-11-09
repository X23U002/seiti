// ==========================================
// スマホの画面下のタブ（地図・作品・スタンプ・マイページ）
// メニューを開かなくても、よく使うページへすぐ移れるようにする
// 読み込んだページの一番下に出す（見た目は tab-bar.css。広い画面では出さない）
// ==========================================
(function () {
    const TABS = [
        {
            href: "map.html",
            label: "地図",
            pages: ["map.html"],
            icon: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>'
        },
        {
            href: "works.html",
            label: "作品",
            pages: ["works.html", "work.html"],
            icon: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="m10 8 5 3-5 3z"/><path d="M8 21h8"/>'
        },
        {
            href: "stamp.html",
            label: "スタンプ",
            pages: ["stamp.html"],
            icon: '<circle cx="12" cy="9" r="5"/><path d="M8 13.5 7 21l5-3 5 3-1-7.5"/>'
        },
        {
            href: "mypage.html",
            label: "マイページ",
            pages: ["mypage.html", "history.html", "inbox.html"],
            icon: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>'
        }
    ];

    function addTabBar() {
        if (document.querySelector(".tab-bar")) return;

        const page = location.pathname.split("/").pop() || "map.html";
        const nav = document.createElement("nav");
        nav.className = "tab-bar";
        nav.setAttribute("aria-label", "よく使うページ");

        TABS.forEach(function (tab) {
            const link = document.createElement("a");
            link.className = "tab-bar-item";
            link.href = tab.href;
            if (tab.pages.indexOf(page) !== -1) {
                link.setAttribute("aria-current", "page");
            }
            link.innerHTML =
                '<svg class="tab-bar-icon" viewBox="0 0 24 24" aria-hidden="true">' + tab.icon + "</svg>" +
                '<span class="tab-bar-label"></span>';
            link.querySelector(".tab-bar-label").textContent = tab.label;
            nav.appendChild(link);
        });

        document.body.appendChild(nav);
        document.body.classList.add("has-tab-bar");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", addTabBar);
    } else {
        addTabBar();
    }
})();

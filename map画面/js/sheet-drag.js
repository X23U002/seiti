// ==========================================
// スマホの聖地の詳細パネル（画面下から出るシート）の操作
// ・中はブラウザのふつうのスクロール（こちらからは割り込まない）。少しスクロールしたら全画面に広げる
// ・上の取っ手（横棒）を下になぞると閉じる（全画面の時は元の高さに戻す）。上になぞると全画面に広げる
// ・取っ手を軽く叩くと、全画面と元の高さを切りかえる
// 中のなぞりを受け取って止める作りにすると、ブラウザはこちらの返事を待ってからスクロールを始めるので、
// 地図の描画で忙しいスマホでは、すぐにスクロールが始まらない（長押ししないと動かない）
// ==========================================

const MOBILE_QUERY = "(max-width: 600px)";
const CLOSE_PX = 90;          // 取っ手をこれより下になぞって離すと閉じる（全画面の時は元の高さに戻す）
const EXPAND_PX = 50;         // 取っ手をこれより上になぞると全画面に広げる
const TAP_PX = 8;             // これより動かなければ「叩いた」とみなす
const EXPAND_ON_SCROLL_PX = 24; // 中をこれより下までスクロールしたら全画面に広げる
const EXPANDED_CLASS = "is-sheet-expanded";

function isMobile() {
    return window.matchMedia(MOBILE_QUERY).matches;
}

function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// popup：mapboxgl.Popup（詳細の中身を作った後に、開くたびに呼んでよい）
export function enableSheetDrag(popup) {
    const container = popup.getElement();
    const content = container && container.querySelector(".mapboxgl-popup-content");
    if (!content) {
        return;
    }

    // 開いた時に Mapbox が最初のリンクに注目を移すと、中が少しスクロールして写真の上が切れるので、一番上に戻す
    content.scrollTop = 0;
    requestAnimationFrame(function () {
        content.scrollTop = 0;
    });

    if (content.dataset.sheetDrag) {
        return;
    }
    content.dataset.sheetDrag = "1";

    // 取っ手（スマホの幅の時だけ見せる。style.css）
    const handle = document.createElement("div");
    handle.className = "sheet-handle";
    handle.setAttribute("aria-hidden", "true");
    content.prepend(handle);

    function sheet() {
        return popup.getElement();
    }

    function isExpanded() {
        const element = sheet();
        return Boolean(element && element.classList.contains(EXPANDED_CLASS));
    }

    function setExpanded(expanded) {
        const element = sheet();
        if (element) {
            element.classList.toggle(EXPANDED_CLASS, expanded);
        }
    }

    function setOffset(pixels, animate) {
        const element = sheet();
        if (!element) return;
        element.style.transition = animate && !prefersReducedMotion() ? "translate .2s ease" : "none";
        element.style.translate = pixels ? "0 " + pixels + "px" : "";
    }

    function closeSheet() {
        const element = sheet();
        if (!element || prefersReducedMotion()) {
            popup.remove();
            return;
        }
        element.style.transition = "translate .18s ease-in";
        element.style.translate = "0 100%";
        setTimeout(function () {
            popup.remove();
        }, 180);
    }

    // 中をスクロールしたら全画面に広げる（スクロールはブラウザに任せたまま。passive）
    content.addEventListener("scroll", function () {
        if (isMobile() && !isExpanded() && content.scrollTop > EXPAND_ON_SCROLL_PX) {
            setExpanded(true);
        }
    }, { passive: true });

    // ---------- 取っ手のなぞり（取っ手はスクロールしないので、止めてもスクロールの邪魔にならない） ----------
    let startY = null;
    let deltaY = 0;

    handle.addEventListener("touchstart", function (event) {
        startY = isMobile() && event.touches.length === 1 ? event.touches[0].clientY : null;
        deltaY = 0;
    }, { passive: true });

    handle.addEventListener("touchmove", function (event) {
        if (startY === null) {
            return;
        }
        if (event.cancelable) {
            event.preventDefault();
        }
        deltaY = event.touches[0].clientY - startY;

        if (deltaY > 0) {
            setOffset(deltaY, false);
        } else if (deltaY < -EXPAND_PX && !isExpanded()) {
            setExpanded(true);
        }
    }, { passive: false });

    function finish() {
        if (startY === null) {
            return;
        }
        startY = null;

        if (Math.abs(deltaY) < TAP_PX) {
            // 叩いた：全画面と元の高さを切りかえる
            setOffset(0, false);
            setExpanded(!isExpanded());
            return;
        }

        if (deltaY > CLOSE_PX) {
            if (isExpanded()) {
                setExpanded(false);
                setOffset(0, true);
            } else {
                closeSheet();
            }
            return;
        }

        setOffset(0, true);
    }

    handle.addEventListener("touchend", finish);
    handle.addEventListener("touchcancel", function () {
        startY = null;
        setOffset(0, true);
    });
}

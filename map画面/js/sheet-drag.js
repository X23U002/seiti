// ==========================================
// スマホの聖地の詳細パネル（画面下から出るシート）を指でなぞって操作する
// ・下になぞると閉じる（全画面に広げている時は、元の高さに戻す）
// ・上になぞると全画面に広げる（広げた後は、中をふつうにスクロールできる）
// 中をスクロールしている途中は邪魔しない（一番上にいる時だけ、下になぞると閉じる）
// ==========================================

const MOBILE_QUERY = "(max-width: 600px)";
const START_PX = 8;      // これより動いたら、なぞり始めとみなす
const CLOSE_PX = 90;     // これより下になぞって離すと閉じる（広げている時は元の高さに戻す）
const EXPAND_PX = 50;    // これより上になぞると全画面に広げる
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

    // 開いた時に Mapbox が最初のリンクに注目を移すと、中が少しスクロールして写真の上が切れ、
    // 下になぞっても閉じなくなるので、一番上に戻す
    content.scrollTop = 0;
    requestAnimationFrame(function () {
        content.scrollTop = 0;
    });

    if (content.dataset.sheetDrag) {
        return;
    }
    content.dataset.sheetDrag = "1";

    // なぞれることが分かる取っ手（スマホの幅の時だけ見せる。style.css）
    const handle = document.createElement("div");
    handle.className = "sheet-handle";
    handle.setAttribute("aria-hidden", "true");
    content.prepend(handle);

    let startY = null;
    let deltaY = 0;
    let mode = null; // "down"（閉じる・戻す） / "up"（広げる）

    function sheet() {
        return popup.getElement();
    }

    function isExpanded() {
        const element = sheet();
        return Boolean(element && element.classList.contains(EXPANDED_CLASS));
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

    // 触った所から詳細の中までに、別にスクロールできる所（「訪れる前に」の欄など）があるか
    function isInInnerScroller(target) {
        for (let element = target; element && element !== content; element = element.parentElement) {
            const overflow = getComputedStyle(element).overflowY;
            if ((overflow === "auto" || overflow === "scroll") && element.scrollHeight > element.clientHeight + 1) {
                return true;
            }
        }
        return false;
    }

    content.addEventListener("touchstart", function (event) {
        startY = null;
        if (!isMobile() || event.touches.length !== 1 || isInInnerScroller(event.target)) {
            return;
        }
        startY = event.touches[0].clientY;
        deltaY = 0;
        mode = null;
    }, { passive: true });

    content.addEventListener("touchmove", function (event) {
        if (startY === null) {
            return;
        }
        deltaY = event.touches[0].clientY - startY;

        if (mode === null) {
            if (Math.abs(deltaY) < START_PX) {
                return;
            }
            // ブラウザがもうスクロールを始めている（止められない）時は、割り込まずにスクロールに任せる
            // （止めようとすると、指が動くたびにコンソールに「Ignored attempt to cancel a touchmove」が出る）
            const atTop = content.scrollTop <= 0;
            if (!event.cancelable) {
                startY = null;
                return;
            }
            if (deltaY > 0 && atTop) {
                mode = "down";
            } else if (deltaY < 0 && atTop && !isExpanded()) {
                // 中が一番上の時だけ、上になぞると全画面に広げる（途中までスクロールしていれば、ふつうにスクロール）
                mode = "up";
            } else {
                // 中のスクロールに任せる
                startY = null;
                return;
            }
        }

        if (event.cancelable) {
            event.preventDefault();
        }

        if (mode === "down") {
            setOffset(Math.max(0, deltaY), false);
        } else if (deltaY < -EXPAND_PX) {
            sheet().classList.add(EXPANDED_CLASS);
            mode = "done";
        }
    }, { passive: false });

    function finish() {
        if (startY === null) {
            return;
        }
        startY = null;

        if (mode === "down" && deltaY > CLOSE_PX) {
            if (isExpanded()) {
                sheet().classList.remove(EXPANDED_CLASS);
                setOffset(0, true);
            } else {
                closeSheet();
            }
            return;
        }

        if (mode === "down") {
            setOffset(0, true);
        }
    }

    content.addEventListener("touchend", finish);
    content.addEventListener("touchcancel", finish);
}

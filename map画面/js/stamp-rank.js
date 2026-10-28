// ==========================================
// スタンプのランク（同じ聖地でスタンプを取った回数で枠の色が変わる）
// 地図・スタンプ帳・マイページで共通
// ==========================================
(function () {
    // 回数の多い順に並べる
    const STAMP_RANKS = [
        { min: 10, key: "legend", name: "レジェンド" },
        { min: 5, key: "gold", name: "ゴールド" },
        { min: 3, key: "silver", name: "シルバー" },
        { min: 1, key: "bronze", name: "ブロンズ" }
    ];

    // 回数に合うランク（0回なら null）
    window.getStampRank = function (count) {
        return STAMP_RANKS.find(function (rank) {
            return count >= rank.min;
        }) || null;
    };

    // 次のランクと、あと何回で上がるか（最高ランクなら null）
    window.getNextStampRank = function (count) {
        const next = STAMP_RANKS.slice().reverse().find(function (rank) {
            return rank.min > count;
        });
        return next ? { rank: next, remaining: next.min - count } : null;
    };

    // 聖地の画像の URL（spot-image.js の getSpotImageSrc と同じ。html/ の中のページから見た場所）
    // 画像が無ければ空文字
    function stampImageSrc(imageUrl) {
        if (!imageUrl || imageUrl === "no_image" || imageUrl === "not_image") return "";
        if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
        return "../" + encodeURI(String(imageUrl).replace(/^\/+/, ""));
    }

    // スタンプの丸の中に、その聖地に登録した画像を入れる
    // 画像が無い・読み込めない時は ⛩️ を出す
    window.setStampImage = function (element, imageUrl) {
        element.textContent = "";
        element.classList.remove("has-image");

        const src = stampImageSrc(imageUrl);
        if (!src) {
            element.textContent = "⛩️";
            return;
        }

        const image = document.createElement("img");
        image.className = "stamp-image";
        image.src = src;
        image.alt = "";
        image.decoding = "async";
        image.onerror = function () {
            image.remove();
            element.classList.remove("has-image");
            element.textContent = "⛩️";
        };
        element.classList.add("has-image");
        element.appendChild(image);
    };

    // スタンプの丸にランクの枠を付ける（fill は中の色＝作品の色）
    window.applyStampRank = function (element, count, fill) {
        STAMP_RANKS.forEach(function (rank) {
            element.classList.remove("rank-" + rank.key);
        });
        element.classList.remove("rank-ring");

        const rank = window.getStampRank(count);
        if (!rank) return null;

        element.classList.add("rank-ring", "rank-" + rank.key);
        if (fill) {
            element.style.setProperty("--stamp-fill", fill);
        }
        return rank;
    };
})();

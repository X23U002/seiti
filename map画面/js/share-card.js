// ==========================================
// SNS で共有できる画像（スタンプ帳の記録・作品のコンプリート）
// window.drawShareCard(data) → Promise<Blob>（1080×1350 の PNG）
//   data：{ heading, big, sub, works: [{ title, color, got, total }], badges: ["👣", …] }
// window.shareImage(blob, fileName, text)：スマホの共有（できなければ画像を保存）
// ==========================================
(function () {
    const W = 1080;
    const H = 1350;
    const FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif';

    function roundRect(g, x, y, w, h, r) {
        g.beginPath();
        g.moveTo(x + r, y);
        g.arcTo(x + w, y, x + w, y + h, r);
        g.arcTo(x + w, y + h, x, y + h, r);
        g.arcTo(x, y + h, x, y, r);
        g.arcTo(x, y, x + w, y, r);
        g.closePath();
    }

    // 長い文字は、幅に収まるように後ろを「…」にする
    function fitText(g, text, maxWidth) {
        let value = String(text || "");
        if (g.measureText(value).width <= maxWidth) return value;
        while (value.length > 1 && g.measureText(value + "…").width > maxWidth) {
            value = value.slice(0, -1);
        }
        return value + "…";
    }

    window.drawShareCard = function (data) {
        const canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = H;
        const g = canvas.getContext("2d");

        // 背景（紺のグラデーション）と、白いカード
        const background = g.createLinearGradient(0, 0, W, H);
        background.addColorStop(0, "#0b3c5d");
        background.addColorStop(1, "#14537f");
        g.fillStyle = background;
        g.fillRect(0, 0, W, H);

        g.fillStyle = "#ffffff";
        roundRect(g, 60, 150, W - 120, H - 270, 40);
        g.fill();

        // いちばん上：アプリの名前
        g.fillStyle = "#ffffff";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.font = "bold 52px " + FONT;
        g.fillText("⛩️ 聖地巡礼NAVI", W / 2, 80);

        // 見出し・大きな数字・説明
        g.fillStyle = "#0b3c5d";
        g.font = "bold 50px " + FONT;
        g.fillText(fitText(g, data.heading, W - 200), W / 2, 240);

        g.fillStyle = "#e5a00d";
        g.font = "bold 150px " + FONT;
        g.fillText(fitText(g, data.big, W - 200), W / 2, 390);

        g.fillStyle = "#6b7b8c";
        g.font = "36px " + FONT;
        g.fillText(fitText(g, data.sub, W - 200), W / 2, 500);

        // 作品ごとの進み具合（多い順に4作品まで）
        const works = (data.works || []).slice(0, 4);
        let y = 580;
        g.textAlign = "left";
        works.forEach(function (work) {
            g.fillStyle = "#2c3e50";
            g.font = "bold 34px " + FONT;
            g.fillText(fitText(g, work.title, 640), 130, y);
            g.textAlign = "right";
            g.fillStyle = "#6b7b8c";
            g.font = "32px " + FONT;
            g.fillText(work.got + " / " + work.total, W - 130, y);
            g.textAlign = "left";

            g.fillStyle = "#eef1f3";
            roundRect(g, 130, y + 30, W - 260, 22, 11);
            g.fill();
            if (work.got > 0) {
                g.fillStyle = work.color || "#0b3c5d";
                roundRect(g, 130, y + 30, Math.max(22, (W - 260) * work.got / work.total), 22, 11);
                g.fill();
            }
            y += 110;
        });

        // 取ったバッジ
        const badges = (data.badges || []).slice(0, 8);
        if (badges.length > 0) {
            g.textAlign = "center";
            g.fillStyle = "#6b7b8c";
            g.font = "bold 30px " + FONT;
            g.fillText("獲得したバッジ", W / 2, H - 260);
            g.font = "64px " + FONT;
            const step = Math.min(110, (W - 240) / badges.length);
            const startX = W / 2 - step * (badges.length - 1) / 2;
            badges.forEach(function (icon, index) {
                g.fillText(icon, startX + step * index, H - 180);
            });
        }

        // いちばん下：ハッシュタグ
        g.textAlign = "center";
        g.fillStyle = "#ffffff";
        g.font = "bold 36px " + FONT;
        g.fillText("#聖地巡礼NAVI  #聖地巡礼", W / 2, H - 55);

        return new Promise(function (resolve) {
            canvas.toBlob(resolve, "image/png");
        });
    };

    // スマホの共有（LINE・X・Instagram など）。共有できない時は画像を保存する
    window.shareImage = async function (blob, fileName, text) {
        const file = new File([blob], fileName, { type: "image/png" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file], text: text });
                return "shared";
            } catch (error) {
                if (error && error.name === "AbortError") return "cancelled";
            }
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        return "saved";
    };
})();

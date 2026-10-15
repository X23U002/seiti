// ==========================================
// 説明文から「何話の場面か」を読み取って、EP5 のような札にする
// 例）「1話。」→ EP1、「1期 第3話」→ 1期 EP3、「劇場版」→ 劇場版
// 読み取れなければ空文字
// （地図の詳細・お気に入り一覧で共通）
// ==========================================
export function getEpisodeLabel(text) {
    // 最初の文だけを見る（後ろの「2話でも登場」などに引っ張られないように）
    const first =
        String(text || "")
            .replace(/[０-９]/g, function (character) {
                return String.fromCharCode(character.charCodeAt(0) - 0xFEE0);
            })
            .split("。")[0];

    if (/劇場版/.test(first)) {
        return "劇場版";
    }

    const season = first.match(/(\d+)期/);
    const episode = first.match(/第?\s*(\d+)\s*話/);
    const seasonText = season ? season[1] + "期" : "";

    if (episode) {
        return (seasonText ? seasonText + " " : "") + "EP" + episode[1];
    }

    if (/最終話/.test(first)) {
        return (seasonText ? seasonText + " " : "") + "最終話";
    }

    if (seasonText) {
        return seasonText;
    }

    if (/^(OP|ＯＰ)/.test(first)) {
        return "OP";
    }

    if (/^(ED|ＥＤ)/.test(first)) {
        return "ED";
    }

    return "";
}

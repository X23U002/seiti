// ==========================================
// 何期の何話の場面か（地図の詳細・お気に入り一覧・管理ページで共通）
// 聖地データに season（期）・episode（話）が入っていればそれを使う（0 は「指定なし」）。
// どちらも無い時は、説明文の最初の一文から読み取る
// 例）「1話。」→ EP1、「1期 第3話」→ 1期 EP3、「劇場版」→ 劇場版
// ==========================================

// 説明文の最初の一文から { season, episode, special } を読み取る
// season・episode は数字（無ければ 0）、special は「劇場版」「最終話」「OP」「ED」か空文字
export function parseEpisode(text) {
    // 最初の文だけを見る（後ろの「2話でも登場」などに引っ張られないように）
    const first =
        String(text || "")
            .replace(/[０-９]/g, function (character) {
                return String.fromCharCode(character.charCodeAt(0) - 0xFEE0);
            })
            .split("。")[0];

    const result = { season: 0, episode: 0, special: "" };

    if (/劇場版/.test(first)) {
        result.special = "劇場版";
        return result;
    }

    const season = first.match(/(\d+)期/);
    const episode = first.match(/第?\s*(\d+)\s*話/);

    if (season) {
        result.season = Number(season[1]);
    }

    if (episode) {
        result.episode = Number(episode[1]);
    } else if (/最終話/.test(first)) {
        result.special = "最終話";
    } else if (!season && /^(OP|ＯＰ)/.test(first)) {
        result.special = "OP";
    } else if (!season && /^(ED|ＥＤ)/.test(first)) {
        result.special = "ED";
    }

    return result;
}

// { season, episode, special } を「1期 EP12」のような札の文字にする（何も無ければ空文字）
export function formatEpisode(parsed) {
    const season = Number(parsed.season) || 0;
    const episode = Number(parsed.episode) || 0;
    const seasonText = season > 0 ? season + "期" : "";
    const episodeText = episode > 0 ? "EP" + episode : (parsed.special || "");

    if (parsed.special === "劇場版") {
        return "劇場版";
    }

    return [seasonText, episodeText].filter(Boolean).join(" ");
}

// 説明文だけから札の文字を作る
export function getEpisodeLabel(text) {
    return formatEpisode(parseEpisode(text));
}

// 聖地データから札の文字を作る（期・話が入っていればそれを優先）
export function getSpotEpisodeLabel(spot) {
    const season = Number(spot && spot.season) || 0;
    const episode = Number(spot && spot.episode) || 0;

    if (season > 0 || episode > 0) {
        return formatEpisode({ season: season, episode: episode, special: "" });
    }

    return getEpisodeLabel(spot && spot.spot_info);
}

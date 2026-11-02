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

// 聖地データの { season, episode, special }（期・話が入っていればそれを優先）
export function getSpotEpisode(spot) {
    const season = Number(spot && spot.season) || 0;
    const episode = Number(spot && spot.episode) || 0;

    if (season > 0 || episode > 0) {
        return { season: season, episode: episode, special: "" };
    }

    return parseEpisode(spot && spot.spot_info);
}

// 聖地データから札の文字を作る（期・話が入っていればそれを優先）
export function getSpotEpisodeLabel(spot) {
    return formatEpisode(getSpotEpisode(spot));
}

// 話で絞り込む時の目印（「1-3」＝1期3話、「0-5」＝期なしの5話、「劇場版」など。分からなければ空文字）
export function getSpotEpisodeKey(spot) {
    const parsed = getSpotEpisode(spot);
    if (parsed.special === "劇場版") return parsed.special;
    if (parsed.season > 0 || parsed.episode > 0) return parsed.season + "-" + parsed.episode;
    return parsed.special;
}

// 目印を並べる順：期 → 話 → 劇場版・最終話・OP・ED → 分からないもの
const SPECIAL_ORDER = ["最終話", "劇場版", "OP", "ED"];

export function compareEpisodeKeys(a, b) {
    const rank = function (key) {
        if (key === "") return [3, 0, 0];
        const special = SPECIAL_ORDER.indexOf(key);
        if (special !== -1) return [2, special, 0];
        const parts = key.split("-").map(Number);
        return [1, parts[0] || 0, parts[1] || 0];
    };
    const x = rank(a);
    const y = rank(b);
    for (let i = 0; i < x.length; i++) {
        if (x[i] !== y[i]) return x[i] - y[i];
    }
    return 0;
}

// 目印を札の文字にする（「1期 EP3」「EP5」「1期」「劇場版」、分からなければ「話数不明」）
export function formatEpisodeKey(key) {
    if (key === "") return "話数不明";
    if (SPECIAL_ORDER.includes(key)) return key;
    const parts = key.split("-").map(Number);
    return formatEpisode({ season: parts[0] || 0, episode: parts[1] || 0, special: "" });
}

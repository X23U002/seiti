// ==========================================
// 作品名と作品ごとの色（地図・スタンプ帳・マイページで共通）
// データの読み込み順で色が変わらないよう、作品ごとに色を固定する。
// ここに無い作品は、作品名から決まる色（毎回同じ色）になる
// ==========================================
export const TITLE_COLORS = {
    "ガールズバンドクライ": "#E53935",
    "響け！ユーフォニアム": "#1E88E5",
    "やはり俺の青春ラブコメはまちがっている。": "#5E35B1",
    "超かぐや姫！": "#EC407A",
    "青春ブタ野郎はバニーガール先輩の夢を見ない": "#00ACC1",
    "ゆるキャン△": "#43A047",
    "冴えない彼女の育てかた": "#F9A825",
    "リコリス・リコイル": "#6D4C41",
    "【推しの子】": "#FF7043",
    "鬼滅の刃": "#00897B",
    "その他": "#78909C"
};

// 上に無い作品に使う色
const EXTRA_COLORS = [
    "#8E24AA",
    "#3949AB",
    "#C0CA33",
    "#D81B60",
    "#546E7A",
    "#7CB342"
];

export function getTitleColor(title) {
    if (TITLE_COLORS[title]) {
        return TITLE_COLORS[title];
    }
    let sum = 0;
    for (const character of String(title)) {
        sum += character.codePointAt(0);
    }
    return EXTRA_COLORS[sum % EXTRA_COLORS.length];
}

// 作品名が無いスポットは「その他」として扱う
export function getTitleName(spot) {
    return (spot && spot.title_name) || "その他";
}

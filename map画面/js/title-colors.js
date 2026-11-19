// ==========================================
// 作品名と作品ごとの色（地図・スタンプ帳・マイページで共通）
// データの読み込み順で色が変わらないよう、作品ごとに色を固定する。
// ここに無い作品は、聖地を読み込んだ時に registerTitles() で、ほかの作品と見た目がかぶらない色に決める
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
    "ぼっちざろっく！": "#880E4F",
    "君の名は。": "#827717",
    "天気の子": "#37474F",
    "アオのハコ": "#1A237E",
    "その他": "#78909C"
};

// 上に無い作品の色（作品名 → 色）。registerTitles() で、ほかの作品と見た目がかぶらないように決める。
// 聖地を読み込まない画面（スタンプの履歴など）でも同じ色になるよう、端末に覚えておく
const ASSIGNED_KEY = "seitiTitleColors";
let assigned = {};
try {
    const saved = JSON.parse(localStorage.getItem(ASSIGNED_KEY) || "null");
    if (saved && typeof saved === "object") assigned = saved;
} catch (error) {
    // 読めない環境では、作品名から決まる色を使う
}

// ---------- 色の見た目の近さ（CIE Lab の距離。人の目の感じ方に近い） ----------
function hexToRgb(hex) {
    const value = parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHex(rgb) {
    return "#" + rgb.map(function (v) { return Math.round(v).toString(16).padStart(2, "0"); }).join("").toUpperCase();
}

function hslToRgb(h, s, l) {
    const a = s * Math.min(l, 1 - l);
    const f = function (n) {
        const k = (n + h / 30) % 12;
        return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
    };
    return [f(0), f(8), f(4)];
}

function rgbToLab(rgb) {
    const linear = rgb.map(function (v) {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    const x = (linear[0] * 0.4124 + linear[1] * 0.3576 + linear[2] * 0.1805) / 0.95047;
    const y = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    const z = (linear[0] * 0.0193 + linear[1] * 0.1192 + linear[2] * 0.9505) / 1.08883;
    const f = function (t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; };
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function labDistance(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// 白い文字との見やすさ（コントラスト比）
function contrastWithWhite(rgb) {
    const linear = rgb.map(function (v) {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    return 1.05 / (luminance + 0.05);
}

// 選べる色：色相を 10° ごと・濃さ3段階のうち、作品名の札の白い文字が読める色（コントラスト比 3 以上）
const CANDIDATES = (function () {
    const list = [];
    [0.38, 0.30, 0.46].forEach(function (lightness) {
        for (let hue = 0; hue < 360; hue += 10) {
            const rgb = hslToRgb(hue, 0.7, lightness);
            if (contrastWithWhite(rgb) < 3) continue;
            const hex = rgbToHex(rgb);
            list.push({ hex: hex, lab: rgbToLab(hexToRgb(hex)) });
        }
    });
    return list;
})();

function hashTitle(title) {
    let sum = 0;
    for (const character of String(title)) {
        sum = (sum * 31 + character.codePointAt(0)) >>> 0;
    }
    return sum;
}

// 聖地を読み込んだ時に、全部の作品名を渡す。上に無い作品に、それまでに使った色と一番離れて見える色を1つずつ割り当てる。
// 作品名の順に決めるので、同じ作品の一覧なら、どの画面・どの端末でも同じ色になる
export function registerTitles(titles) {
    const extra = Array.from(new Set(Array.from(titles || [])
        .map(function (title) { return String(title || "その他"); })
        .filter(function (title) { return !TITLE_COLORS[title]; })))
        .sort();

    const used = Object.values(TITLE_COLORS).map(function (hex) { return rgbToLab(hexToRgb(hex)); });
    const next = {};

    extra.forEach(function (title) {
        let best = null;
        let bestDistance = -1;
        CANDIDATES.forEach(function (candidate) {
            const distance = Math.min.apply(null, used.map(function (lab) { return labDistance(lab, candidate.lab); }));
            if (distance > bestDistance) {
                bestDistance = distance;
                best = candidate;
            }
        });
        next[title] = best.hex;
        used.push(best.lab);
    });

    assigned = next;
    try {
        localStorage.setItem(ASSIGNED_KEY, JSON.stringify(assigned));
    } catch (error) {
        // 保存できない環境では何もしない
    }
}

export function getTitleColor(title) {
    if (TITLE_COLORS[title]) {
        return TITLE_COLORS[title];
    }
    if (assigned[title]) {
        return assigned[title];
    }
    // registerTitles() の前に呼ばれた時（すぐに registerTitles() の色に変わる）
    return CANDIDATES[hashTitle(title) % CANDIDATES.length].hex;
}

// 作品名が無いスポットは「その他」として扱う
export function getTitleName(spot) {
    return (spot && spot.title_name) || "その他";
}

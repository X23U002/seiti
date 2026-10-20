// ==========================================
// 地図画面で使う文字の処理（検索のあいまい比較・作品の略称・HTMLエスケープ）
// 地図の状態を使わない処理なので、Script.js から分けている
// ==========================================

// =========================================================
// あいまい検索用の文字変換
// =========================================================
export function normalizeText(text) {
    if (!text) {
        return "";
    }

    return String(text)
        .toLowerCase()

        .replace(
            /[Ａ-Ｚａ-ｚ０-９]/g,
            function (character) {
                return String.fromCharCode(
                    character.charCodeAt(0) -
                    0xFEE0
                );
            }
        )

        .replace(
            /[\u30a1-\u30f6]/g,
            function (character) {
                return String.fromCharCode(
                    character.charCodeAt(0) -
                    0x60
                );
            }
        )

        .replace(
            /[  ・！!？\?△○〇\-ー。、，,．.【】「」『』（）()〔〕［］\[\]“”"'’〜~：:]/g,
            ""
        );
}

// =========================================================
// 作品の略称（検索欄に略称を入れても作品の聖地が出るように）
// キー：略称、値：Firestore の title_name
// =========================================================
const TITLE_ALIASES = {
    "ガルクラ": "ガールズバンドクライ",
    "ユーフォ": "響け！ユーフォニアム",
    "響け": "響け！ユーフォニアム",
    "俺ガイル": "やはり俺の青春ラブコメはまちがっている。",
    "はまち": "やはり俺の青春ラブコメはまちがっている。",
    "かぐや姫": "超かぐや姫！",
    "青ブタ": "青春ブタ野郎はバニーガール先輩の夢を見ない",
    "ゆるキャン": "ゆるキャン△",
    "冴えカノ": "冴えない彼女の育てかた",
    "リコリコ": "リコリス・リコイル",
    "推しの子": "【推しの子】",
    "鬼滅": "鬼滅の刃"
};

// 入力が略称（またはその一部）なら、対応する作品名を返す
export function findAliasTitles(keyword) {
    return Object.keys(TITLE_ALIASES)
        .filter(function (alias) {
            const normalizedAlias = normalizeText(alias);
            return normalizedAlias.includes(keyword) || keyword.includes(normalizedAlias);
        })
        .map(function (alias) {
            return normalizeText(TITLE_ALIASES[alias]);
        });
}


// =========================================================
// HTMLエスケープ
// =========================================================
export function escapeHTML(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

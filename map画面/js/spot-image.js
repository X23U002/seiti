// ==========================================
// 聖地の画像（地図の詳細・管理ページで共通）
// 画像は GitHub のこのリポジトリの map画面/images/spots/ に、作品ごとのフォルダに分けて置く。
//   例：eupho/eupho_s0701.jpg（響け！ユーフォニアムの s0701）
// 使えるのは現地で撮った写真など、使ってよい写真だけ。アニメの場面の画像は著作権上使わない
// （images/spots/anime/ を指していても表示しない）。
// spot の image_url には「images/spots/eupho/eupho_s0701.jpg」のように保存する（画像なしは "no_image"）。
// https:// から始まるURLが入っていれば、そのまま使う
// ==========================================

// 画像を置くフォルダ（map画面/ から見た場所）
export const SPOT_IMAGE_DIR = "images/spots/";

// 画像が無い時の値（古いデータは "not_image" や空文字）。
// アニメの場面の画像（images/spots/anime/）も、著作権上使わないので「画像なし」と同じに扱う
function isNoImage(value) {
    return !value || value === "no_image" || value === "not_image" ||
        /(^|\/)images\/spots\/anime\//.test(String(value));
}

// 管理ページで入力された値を、保存する形にする
// ・フォルダ/ファイル名（eupho/eupho_s0701.jpg） → images/spots/eupho/eupho_s0701.jpg
// ・ファイル名だけ（s11.jpg）             → images/spots/s11.jpg
// ・GitHub の画像ページのURL               → images/spots/ujibashi.jpg
// ・map画面/images/spots/… や ../images/… → images/spots/…
// ・それ以外の https:// のURL              → そのまま
// ・空欄                                   → no_image
export function normalizeSpotImage(input) {
    let value = String(input || "").trim();

    if (isNoImage(value)) {
        return "no_image";
    }

    // GitHub の画像ページ（…/blob/main/map画面/images/spots/a.jpg）や
    // 生データ（raw.githubusercontent.com/…）のURLは、リポジトリの中の場所にする
    const github = value.match(/^https:\/\/(?:github\.com\/[^/]+\/[^/]+\/(?:blob|raw)|raw\.githubusercontent\.com\/[^/]+\/[^/]+)\/[^/]+\/(.+)$/);
    if (github) {
        value = decodeURIComponent(github[1]);
    } else if (/^https?:\/\//i.test(value)) {
        return value;
    }

    value = value
        .replace(/^(\.\.?\/)+/, "")
        .replace(/^\/+/, "")
        .replace(/^map画面\//, "");

    // 「eupho/eupho_s0701.jpg」やファイル名だけなら、画像のフォルダの中にあるものとする
    if (!value.startsWith("images/")) {
        value = SPOT_IMAGE_DIR + value;
    }

    return value;
}

// 表示に使うURL（画像が無ければ空文字）
// html/ の中のページから見た場所にする（地図・管理ページはどちらも html/ にある）
export function getSpotImageSrc(imageUrl) {
    if (isNoImage(imageUrl)) {
        return "";
    }

    if (/^https?:\/\//i.test(imageUrl)) {
        return imageUrl;
    }

    return "../" + encodeURI(String(imageUrl).replace(/^\/+/, ""));
}

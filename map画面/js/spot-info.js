// ==========================================
// 聖地を訪れる人への情報（入れる時間・定休日・料金・アクセス・注意）
// spot の任意の項目。管理ページで入力し、地図の聖地の詳細に「訪れる前に」として出す
// ==========================================
export const VISIT_FIELDS = [
    { key: "open_hours", label: "入れる時間", max: 100, placeholder: "(例) 9:00〜17:00（境内は24時間）" },
    { key: "closed_days", label: "定休日", max: 100, placeholder: "(例) 月曜日（祝日の時は翌日）" },
    { key: "fee", label: "料金", max: 100, placeholder: "(例) 無料／大人 600円" },
    { key: "access", label: "アクセス", max: 200, placeholder: "(例) 京阪宇治駅から徒歩5分" },
    { key: "caution", label: "注意", max: 300, placeholder: "(例) 私有地のため敷地内に入らない・店内の撮影は禁止" }
];

// どの聖地にも出す、聖地巡礼のマナー
export const MANNER_NOTE =
    "聖地の多くは、地元の方が暮らしたり働いたりしている場所です。大声・私有地への立ち入り・人が写る撮影は控えましょう。";

// 入力されている項目だけを [{ label, value }] で返す
export function getVisitInfo(spot) {
    return VISIT_FIELDS
        .map(function (field) {
            const value = spot && typeof spot[field.key] === "string" ? spot[field.key].trim() : "";
            return { key: field.key, label: field.label, value: value };
        })
        .filter(function (item) { return item.value !== ""; });
}

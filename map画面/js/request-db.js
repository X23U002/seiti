// ==========================================
// 聖地登録の申請・お問い合わせをDBに送る（どちらもログインが必要）
// 作成するだけで、内容の確認・地図への追加は運営が Firebase コンソールで行う
//   request_spot/{自動ID}：聖地登録の申請（request_state: "申請中" で作成）
//   contact/{自動ID}     ：お問い合わせ（contact_state: "未対応" で作成）
// 項目名はチームで決めたルール（Firestore のルール）に合わせている
// ==========================================
import {
    addDoc,
    collection,
    doc,
    GeoPoint
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

import { db } from "./firebase-db.js?v=917161b9";
import { getLoginUserId } from "./stamp-db.js?v=af011576";

export { getLoginUserId };

// 連続で送れないようにする間隔（ミリ秒）
const SEND_INTERVAL_MS = 60 * 1000;

// 前回送ってから SEND_INTERVAL_MS たっていなければ、あと何秒かを返す（送れるなら 0）
export function getWaitSeconds(kind) {
    try {
        const last = Number(localStorage.getItem("seitiLastSent_" + kind)) || 0;
        return Math.max(0, Math.ceil((last + SEND_INTERVAL_MS - Date.now()) / 1000));
    } catch (e) {
        return 0;
    }
}

function rememberSent(kind) {
    try {
        localStorage.setItem("seitiLastSent_" + kind, String(Date.now()));
    } catch (e) {
        // 保存できない環境では何もしない
    }
}

function notLoggedIn() {
    return Object.assign(new Error("ログインしていません"), { code: "not-logged-in" });
}

// 聖地登録の申請
// request_title：スポット名、request_info：作品名・住所・期・話・説明をまとめた文
// （説明は複数行になるので最後に置く。管理ページの parseRequestInfo で読み取る）
// coord：地図でピンを置いた位置（置いていなければ入れない）
export async function sendSpotRequest(fields) {
    const userId = await getLoginUserId();
    if (!userId) throw notLoggedIn();

    const lines = [
        "作品名：" + fields.titleName,
        "住所：" + (fields.address || "")
    ];
    if (fields.season || fields.episode) {
        lines.push("期：" + (fields.season || 0));
        lines.push("話：" + (fields.episode || 0));
    }
    lines.push("説明：" + fields.spotInfo);

    const data = {
        user_id: doc(db, "user", userId),
        request_title: fields.spotName,
        image_url: "",
        request_info: lines.join("\n"),
        request_state: "申請中"
    };
    if (fields.position) {
        data.coord = new GeoPoint(fields.position.lat, fields.position.lng);
    }

    await addDoc(collection(db, "request_spot"), data);
    rememberSent("request_spot");
}

// お問い合わせ
export async function sendContact(fields) {
    const userId = await getLoginUserId();
    if (!userId) throw notLoggedIn();

    await addDoc(collection(db, "contact"), {
        user_id: doc(db, "user", userId),
        contact_info: fields.message,
        image_url: "",
        contact_state: "未対応"
    });
    rememberSent("contact");
}

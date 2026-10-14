// ==========================================
// 聖地登録の申請・お問い合わせをDBに送る
// どちらも status: "pending"（審査待ち）で作成するだけ。
// 内容の確認・地図への追加は運営が Firebase コンソールで行う
//   spot_request/{自動ID}：聖地登録の申請
//   contact/{自動ID}     ：お問い合わせ
// ==========================================
import {
    addDoc,
    collection,
    doc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

import { db } from "./firebase-db.js";
import { getLoginUserId } from "./stamp-db.js?v=5";

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

// 聖地登録の申請（ログインが必要）
export async function sendSpotRequest(fields) {
    const userId = await getLoginUserId();
    if (!userId) {
        throw Object.assign(new Error("ログインしていません"), { code: "not-logged-in" });
    }

    await addDoc(collection(db, "spot_request"), {
        user_id: doc(db, "user", userId),
        title_name: fields.titleName,
        spot_name: fields.spotName,
        address: fields.address,
        spot_info: fields.spotInfo,
        status: "pending",
        created_at: serverTimestamp()
    });
    rememberSent("spot_request");
}

// お問い合わせ（ログインしていなくても送れる）
export async function sendContact(fields) {
    const userId = await getLoginUserId();

    await addDoc(collection(db, "contact"), {
        user_id: userId ? doc(db, "user", userId) : null,
        message: fields.message,
        reply_to: fields.replyTo,
        status: "pending",
        created_at: serverTimestamp()
    });
    rememberSent("contact");
}

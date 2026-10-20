// ==========================================
// ニックネームをDB（user/{ユーザーID} の user_name）から読む・保存する
// ==========================================
import {
    doc,
    updateDoc
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

import { db } from "./firebase-db.js?v=917161b9";
// 広告ブロックなどで Firestore の通信が止められても読めるよう、予備の読み方がある読み込みを使う
import { getOneDoc } from "./public-data.js?v=c815b81a";

// 登録されているニックネーム（見つからなければ null）
export async function loadUserName(userId) {
    const data = await getOneDoc("user", userId);
    return data ? data.user_name || null : null;
}

// ニックネームを変更する
export async function saveUserName(userId, name) {
    await updateDoc(doc(db, "user", userId), { user_name: name });
}

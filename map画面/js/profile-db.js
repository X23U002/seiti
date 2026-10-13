// ==========================================
// ニックネームをDB（user/{ユーザーID} の user_name）から読む・保存する
// ==========================================
import {
    doc,
    getDoc,
    updateDoc
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

import { db } from "./firebase-db.js";

// 登録されているニックネーム（見つからなければ null）
export async function loadUserName(userId) {
    const snapshot = await getDoc(doc(db, "user", userId));
    return snapshot.exists() ? snapshot.data().user_name || null : null;
}

// ニックネームを変更する
export async function saveUserName(userId, name) {
    await updateDoc(doc(db, "user", userId), { user_name: name });
}

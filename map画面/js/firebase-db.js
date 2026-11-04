// ==========================================
// Firestore とログイン（Firebase Authentication）の接続（各画面で共通）
// ==========================================
import {
    initializeApp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";

import {
    getFirestore
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

import {
    getAuth
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyCga1yFbLWdLXmMrNwScXuOGUWnz283eYs",
    authDomain: "sisukai-121cf.firebaseapp.com",
    projectId: "sisukai-121cf",
    storageBucket: "sisukai-121cf.firebasestorage.app",
    messagingSenderId: "83286825212",
    appId: "1:83286825212:web:1cd57aecfb2308571a5f79",
    measurementId: "G-GKWJ6BE9M2"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);

// ログイン（Firebase Authentication）
export const auth = getAuth(app);

// 今ログインしている人（未ログインなら null）
// ページを開いた直後は前回のログイン状態を読み込み中なので、終わるまで待ってから返す
export async function getCurrentUser() {
    await auth.authStateReady();
    return auth.currentUser;
}

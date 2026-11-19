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
    browserLocalPersistence,
    browserSessionPersistence,
    indexedDBLocalPersistence,
    initializeAuth
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
// getAuth と同じ保存先を使うが、ポップアップ・リダイレクトでのログイン（Google ログインなど）は使わないので、
// そのための Google の部品（apis.google.com の api.js と iframe）は読み込まない。
// 地図画面ではスタンプ用の compat 版の Auth も同じ部品を読み込み、2つがぶつかって
// 「Uncaught TypeError: u[v] is not a function」が出る。スマホではその部品の準備を待つため、
// ログインの準備が終わらず、Firestore の読み込みが8秒の待ち時間切れになることがあった
export const auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence]
});

// 今ログインしている人（未ログインなら null）
// ページを開いた直後は前回のログイン状態を読み込み中なので、終わるまで待ってから返す
export async function getCurrentUser() {
    await auth.authStateReady();
    return auth.currentUser;
}

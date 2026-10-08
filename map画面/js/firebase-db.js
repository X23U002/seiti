// ==========================================
// Firestore の接続（ログイン・新規登録で共通）
// ==========================================
import {
    initializeApp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";

import {
    getFirestore
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

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

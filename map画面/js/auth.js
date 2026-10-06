// =========================================================
// ログイン（Firebase Authentication：メールアドレスとパスワード）
//
// 使い方（HTML）
//   1. Firebase の compat 版（app・auth）を読み込む
//   2. このファイルを読み込む
//   3. ログインが必要な画面は <html data-require-login> にする
//      → ログインしていなければ login.html へ移動する
//
// ※ スタンプ機能（stampsyori.js）が使う「匿名ログイン」のユーザーは、
//   ログインしていない扱いにする
// =========================================================

(function () {
    const FIREBASE_CONFIG = {
        apiKey: "AIzaSyCga1yFbLWdLXmMrNwScXuOGUWnz283eYs",
        authDomain: "sisukai-121cf.firebaseapp.com",
        projectId: "sisukai-121cf",
        storageBucket: "sisukai-121cf.firebasestorage.app",
        messagingSenderId: "83286825212",
        appId: "1:83286825212:web:1cd57aecfb2308571a5f79",
        measurementId: "G-GKWJ6BE9M2"
    };

    const LOGIN_PAGE = "login.html";
    const requireLogin = document.documentElement.hasAttribute("data-require-login");

    // ログイン確認が終わるまで画面を隠す（一瞬だけ中身が見えるのを防ぐ）
    if (requireLogin) {
        document.documentElement.classList.add("auth-pending");
    }

    if (typeof window.firebase === "undefined") {
        console.error("Firebase が読み込まれていません");
        return;
    }

    if (!window.firebase.apps.length) {
        window.firebase.initializeApp(FIREBASE_CONFIG);
    }

    const auth = window.firebase.auth();

    // メールアドレスで登録したユーザーか（匿名ログインは含めない）
    function isLoggedIn(user) {
        return Boolean(user && !user.isAnonymous);
    }

    // 最初のログイン状態が分かったら1回だけ呼ばれる
    const ready = new Promise(function (resolve) {
        const unsubscribe = auth.onAuthStateChanged(function (user) {
            unsubscribe();
            resolve(user);
        });
    });

    if (requireLogin) {
        ready.then(function (user) {
            if (!isLoggedIn(user)) {
                // ログイン後に元の画面へ戻れるよう、移動前の画面を覚えておく
                sessionStorage.setItem("afterLogin", location.pathname.split("/").pop() + location.search);
                location.replace(LOGIN_PAGE);
                return;
            }
            document.documentElement.classList.remove("auth-pending");
        });
    }

    // Firebase のエラーを日本語のメッセージにする
    function errorMessage(error) {
        const messages = {
            "auth/invalid-email": "メールアドレスの形式が正しくありません。",
            "auth/invalid-credential": "メールアドレスまたはパスワードが違います。",
            "auth/wrong-password": "メールアドレスまたはパスワードが違います。",
            "auth/user-not-found": "メールアドレスまたはパスワードが違います。",
            "auth/user-disabled": "このアカウントは利用できません。",
            "auth/email-already-in-use": "このメールアドレスはすでに登録されています。",
            "auth/credential-already-in-use": "このメールアドレスはすでに登録されています。",
            "auth/weak-password": "パスワードが短すぎます。",
            "auth/too-many-requests": "試行回数が多すぎます。しばらく待ってからお試しください。",
            "auth/network-request-failed": "通信できませんでした。インターネット接続を確認してください。",
            "auth/operation-not-allowed": "メールアドレスでのログインが有効になっていません（Firebaseの設定を確認してください）。"
        };
        return messages[error && error.code] || "エラーが発生しました。時間をおいてもう一度お試しください。";
    }

    window.seitiAuth = {
        auth: auth,
        ready: ready,
        isLoggedIn: isLoggedIn,
        errorMessage: errorMessage,

        // ログイン
        login: function (email, password) {
            return auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL)
                .then(function () {
                    return auth.signInWithEmailAndPassword(email, password);
                });
        },

        // 新規登録。この端末で匿名のままスタンプを集めていた場合は、
        // そのアカウントをメールアドレスのアカウントに切り替えてスタンプを引き継ぐ
        register: async function (name, email, password) {
            await auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);

            let user;
            const current = auth.currentUser;

            if (current && current.isAnonymous) {
                const credential = window.firebase.auth.EmailAuthProvider.credential(email, password);
                user = (await current.linkWithCredential(credential)).user;
            } else {
                user = (await auth.createUserWithEmailAndPassword(email, password)).user;
            }

            await user.updateProfile({ displayName: name });
            return user;
        },

        // パスワード再設定メールを送る
        sendPasswordReset: function (email) {
            return auth.sendPasswordResetEmail(email);
        },

        // 名前の変更
        updateName: function (name) {
            return auth.currentUser.updateProfile({ displayName: name });
        },

        // ログアウト
        logout: function () {
            return auth.signOut();
        },

        // ログイン後に移動する画面（ログインが必要な画面から来た時はそこへ戻る）
        nextPage: function () {
            const next = sessionStorage.getItem("afterLogin");
            sessionStorage.removeItem("afterLogin");
            return next && /^[\w-]+\.html(\?.*)?$/.test(next) ? next : "map.html";
        }
    };
})();

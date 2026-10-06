// ログイン画面

// すでにログインしていれば、そのままマップへ
window.seitiAuth.ready.then(function (user) {
    if (window.seitiAuth.isLoggedIn(user)) {
        location.replace(window.seitiAuth.nextPage());
    }
});

// ログインボタン
async function login() {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const errorBox = document.getElementById("login-error");
    const button = document.getElementById("login-btn");

    setFieldError("email", email === "");
    setFieldError("password", password === "");
    errorBox.hidden = true;

    if (email === "" || password === "") {
        document.querySelector(".form-group.has-error input").focus();
        return;
    }

    // 二重に押されないよう、処理中はボタンを押せなくする
    button.disabled = true;
    button.textContent = "ログイン中…";

    try {
        await window.seitiAuth.login(email, password);
        location.replace(window.seitiAuth.nextPage());
    } catch (error) {
        console.warn("ログインに失敗しました:", error);
        errorBox.textContent = window.seitiAuth.errorMessage(error);
        errorBox.hidden = false;
        button.disabled = false;
        button.textContent = "ログイン";
    }
}

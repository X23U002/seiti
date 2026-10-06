// 新規登録画面（入力 → 確認 → 完了 を1つの画面で切り替える）
// ※ パスワードを別の画面へ持ち越さないよう、確認も同じ画面で行う

// すでにログインしていればマップへ
window.seitiAuth.ready.then(function (user) {
    if (window.seitiAuth.isLoggedIn(user)) {
        location.replace("map.html");
    }
});

// 進捗表示を切り替える
function setStep(current) {
    const order = ["input", "confirm", "done"];
    order.forEach(function (name, index) {
        const step = document.getElementById("step-" + name);
        const currentIndex = order.indexOf(current);
        step.classList.toggle("active", index === currentIndex);
        step.classList.toggle("done", index < currentIndex);
        step.querySelector("span").textContent = index < currentIndex ? "✓" : String(index + 1);
        if (index === currentIndex) {
            step.setAttribute("aria-current", "step");
        } else {
            step.removeAttribute("aria-current");
        }
    });
}

// 入力画面を表示
function showInput() {
    document.getElementById("input-section").hidden = false;
    document.getElementById("confirm-section").hidden = true;
    setStep("input");
    window.scrollTo(0, 0);
}

// 戻るボタン：確認画面なら入力画面へ、入力画面ならログイン画面へ
function goBack() {
    if (!document.getElementById("confirm-section").hidden) {
        showInput();
    } else {
        location.href = "login.html";
    }
}

// 入力チェックをしてから確認画面へ
function goToConfirm() {
    const name = document.getElementById("username").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const passwordConfirm = document.getElementById("password-confirm").value;

    const nameError = name === "";
    const emailError = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const passwordError = !/^[A-Za-z0-9]{8,}$/.test(password);
    const confirmError = passwordConfirm !== password;

    setFieldError("username", nameError);
    setFieldError("email", emailError);
    setFieldError("password", passwordError);
    setFieldError("password-confirm", confirmError);

    if (nameError || emailError || passwordError || confirmError) {
        document.querySelector(".form-group.has-error input").focus();
        return;
    }

    document.getElementById("confirm-name").textContent = name;
    document.getElementById("confirm-email").textContent = email;
    document.getElementById("confirm-password").textContent = "•".repeat(password.length) + "（非表示）";
    document.getElementById("register-error").hidden = true;

    document.getElementById("input-section").hidden = true;
    document.getElementById("confirm-section").hidden = false;
    setStep("confirm");
    window.scrollTo(0, 0);
}

// 登録する
async function register() {
    const name = document.getElementById("username").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const button = document.getElementById("register-btn");
    const errorBox = document.getElementById("register-error");

    button.disabled = true;
    button.textContent = "登録中…";
    errorBox.hidden = true;

    try {
        await window.seitiAuth.register(name, email, password);
        setStep("done");
        document.getElementById("complete-modal").style.display = "flex";
    } catch (error) {
        console.warn("登録に失敗しました:", error);
        errorBox.textContent = window.seitiAuth.errorMessage(error);
        errorBox.hidden = false;
        button.disabled = false;
        button.textContent = "登録する";
    }
}

// マップ画面へ
function goToMap() {
    location.replace("map.html");
}

// ========================================
// 聖地登録
// ========================================

function completeRegister() {

    // 入力内容取得
    const animeName = document.getElementById("animeName").value.trim();
    const address = document.getElementById("address").value.trim();
    const spotText = document.getElementById("spotText").value.trim();

    // 入力チェック（エラーは各項目の下に表示）
    setFieldError("animeName", animeName === "");
    setFieldError("address", address === "");
    setFieldError("spotText", spotText === "");

    const firstError = document.querySelector(".form-group.has-error input, .form-group.has-error textarea");
    if (firstError) {
        firstError.focus();
        return;
    }

    // 登録画面を非表示にして完了画面を表示
    document.getElementById("registerPage").style.display = "none";
    document.getElementById("completePage").style.display = "block";
    window.scrollTo(0, 0);
}

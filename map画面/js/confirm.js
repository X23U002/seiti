// 新規登録入力画面に戻る
function goToRegister() {
    window.location.href = "newaccount.html";
}

// 登録完了処理
function goToComplete() {
    alert("登録が完了しました！地図画面へ移動します。");
    // 登録完了後はマップ画面（または完了画面）に遷移させます
    window.location.href = "map.html"; 
}
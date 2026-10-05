// マイページに戻る
function goToMyPage() {
    window.location.href = "mypage.html";
}

// 案内開始ボタンを押したときの処理
function startRoute() {
    alert("ルート案内を開始します！マップ画面に切り替わります。");
    // 本来はここで現在地からのナビゲーションを開始し、マップ画面に遷移します
    window.location.href = "map.html"; // または tesutomappubokkusuHTML.html
}
// ========================================
// 聖地登録
// ========================================

function completeRegister() {

    // 入力内容取得
    const animeName =
        document.getElementById("animeName").value.trim();

    const address =
        document.getElementById("address").value.trim();

    const spotText =
        document.getElementById("spotText").value.trim();

    // 入力チェック
    if(animeName === ""){

        alert("作品名を入力してください。");

        return;

    }

    if(address === ""){

        alert("住所を入力してください。");

        return;

    }

    if(spotText === ""){

        alert("スポット説明を入力してください。");

        return;

    }

    // 登録画面を非表示
    document.getElementById("registerPage").style.display = "none";

    // 完了画面を表示
    document.getElementById("completePage").style.display = "block";

}

// ========================================
// Enterキーで勝手に送信されるのを防ぐ
// ========================================

document.addEventListener("keydown", function(event){

    if(event.key === "Enter"){

        const tag = document.activeElement.tagName;

        if(tag !== "TEXTAREA"){

            event.preventDefault();

        }

    }

});

// ========================================
// 画像選択
// ========================================

const image =
document.getElementById("image");

if(image){

    image.addEventListener("change",function(){

        if(this.files.length > 0){

            console.log("画像：" + this.files[0].name);

        }

    });

}

console.log("register.js 読み込み完了");
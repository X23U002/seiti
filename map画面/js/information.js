function sendContact() {

    const contactText = document.getElementById("contactText").value.trim();

    // 内容が空なら送信しない
    setFieldError("contactText", contactText === "");
    if (contactText === "") {
        document.getElementById("contactText").focus();
        return;
    }

    document.getElementById("formPage").style.display = "none";
    document.getElementById("completePage").style.display = "block";
    window.scrollTo(0, 0);

}

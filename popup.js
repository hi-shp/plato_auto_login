document.addEventListener("DOMContentLoaded", () => {
    const idInput = document.getElementById("userId");
    const pwInput = document.getElementById("userPw");
    const toggle = document.getElementById("popupToggle");
    const eyeOn = document.getElementById("eyeOn");
    const eyeOff = document.getElementById("eyeOff");
    const eyeBtn = document.getElementById("togglePw");
    const toast = document.getElementById("toast");
    chrome.storage.local.get(["userId", "userPw", "autoLogin"], (data) => {
      if (data.userId) idInput.value = data.userId;
      if (data.userPw) pwInput.value = data.userPw;
      toggle.checked = !!data.autoLogin;
    });
    const save = () => {
      chrome.storage.local.set({
        userId: idInput.value,
        userPw: pwInput.value,
        autoLogin: toggle.checked
      });
    };
    const showToast = (message = "저장되었습니다") => {
      if (!toast) return;
      toast.textContent = message;
      toast.classList.add("show");
      setTimeout(() => {
        toast.classList.remove("show");
      }, 1500);
    };
    idInput.addEventListener("input", () => {
      save();
    });
    pwInput.addEventListener("input", () => {
      save();
    });
    toggle.addEventListener("change", () => {
      save();
      showToast(toggle.checked ? "자동 로그인 사용 설정됨" : "자동 로그인 해제됨");
    });
    eyeBtn.addEventListener("mouseenter", () => {
      pwInput.type = "text";
      eyeOn.style.display = "inline";
      eyeOff.style.display = "none";
    });
    eyeBtn.addEventListener("mouseleave", () => {
      pwInput.type = "password";
      eyeOn.style.display = "none";
      eyeOff.style.display = "inline";
    });
});
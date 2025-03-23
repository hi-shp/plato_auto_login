function attemptLogin() {
    const logo = document.querySelector('img[alt="부산대학교 스마트 교육플랫폼 PLATO"]');
    const isPlatoLogo = logo?.src.includes("plato.pusan.ac.kr/theme/image.php");
    if (!isPlatoLogo) return;
  
    chrome.storage.local.get(["userId", "userPw", "autoLogin"], (data) => {
      if (!data.autoLogin || !data.userId || !data.userPw) return;
  
      const inputA_id = document.querySelector('#input-username');
      const inputA_pw = document.querySelector('#input-password');
      const buttonA = document.querySelector('input[name="loginbutton"]');
  
      const inputB_id = document.querySelector('input[name="username"]');
      const inputB_pw = document.querySelector('input[name="password"]');
      const buttonB = document.querySelector('input[name="loginbutton"]');
  
      if (inputA_id && inputA_pw && buttonA) {
        inputA_id.value = data.userId;
        inputA_pw.value = data.userPw;
        buttonA.click();
      } else if (inputB_id && inputB_pw && buttonB) {
        inputB_id.value = data.userId;
        inputB_pw.value = data.userPw;
        buttonB.click();
      }
    });
  }
  
  // 모바일 대응용 meta 수정
  document.addEventListener("DOMContentLoaded", () => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (meta) {
      meta.setAttribute("content", "width=device-width, initial-scale=1");
    }
  });
  
  // DOM 변경 시 로그인 시도
  const observer = new MutationObserver(() => attemptLogin());
  observer.observe(document, { childList: true, subtree: true });
  
  // 첫 진입 시 바로 로그인 시도
  attemptLogin();
  
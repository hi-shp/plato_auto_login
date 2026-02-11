const attemptLogin = () => {
  const host = window.location.hostname;
  const href = window.location.href;
  const path = window.location.pathname;

  chrome.storage.local.get([
    "hjsId", "hjsPw", "hjsToggle", "hjsPopupClose",
    "userId", "userPw", "popupToggle", "platoPopupClose",
    "bbitsId", "bbitsPw", "bbitsToggle", "bbitsPopupClose"
  ], (data) => {
    
    if (host.includes("onestop.pusan.ac.kr") || host.includes("login.pusan.ac.kr")) {
      if (data.hjsPopupClose) {
        document.querySelectorAll('div[id^="popup_"], .modal-backdrop').forEach(el => el.remove());
      }

      const pwBtn = document.querySelector('a[href*="changeNextPw"]');
      if (pwBtn && !pwBtn.dataset.done) {
        pwBtn.dataset.done = "1";
        
        window.dispatchEvent(new CustomEvent("RUN_PNU_FUNC", { 
          detail: { type: "CHANGE_PW" } 
        }));

        const clickEvt = new MouseEvent("click", {
          view: window,
          bubbles: true,
          cancelable: true
        });
        pwBtn.dispatchEvent(clickEvt);
        return;
      }

      if (host.includes("onestop.pusan.ac.kr")) {
        if (!data.hjsToggle) return;
        
        const loginArea = document.querySelector('#global_login');
        if (loginArea && loginArea.innerText.includes("로그아웃")) return;

        if (path.includes("/main") || path.includes("/index.do")) return;
        if (href.includes("/error/entrypoint")) {
          window.location.replace("https://onestop.pusan.ac.kr/login");
          return;
        }
        
        if (loginArea && !loginArea.dataset.done) {
          loginArea.dataset.done = "1";
          window.dispatchEvent(new CustomEvent("RUN_PNU_FUNC", { detail: { type: "ONESTOP_SSO" } }));
        }
      }
    }

    if (host === "login.pusan.ac.kr") {
      if (!data.hjsToggle) return;
      const b = document.querySelector('#btnLogin');
      const u = document.querySelector('#login_id') || document.querySelector('#username');
      const p = document.querySelector('#login_pw') || document.querySelector('#password');
      if (b && u && p && !b.dataset.done) {
        b.dataset.done = "1";
        u.value = data.hjsId || ""; 
        p.value = data.hjsPw || "";
        b.click();
      }
    }

    if (host.includes("bbits.ac.kr")) {
      if (data.bbitsPopupClose) {
        document.querySelectorAll('[data-action="just_close"]').forEach(b => b.click());
      }
      if (!data.bbitsToggle) return;
      if (document.querySelector('[data-action*="logout"]')) return;
      const loginModalBtn = document.querySelector('[data-action="coursemos_widgets_unifiedloginbar_templets_default_login2_login"]');
      const loginLayer = document.querySelector('.popup_layer.login');
      if (loginModalBtn && (!loginLayer || loginLayer.style.display === 'none')) {
        loginModalBtn.click();
        return;
      }
      const u = document.querySelector('input[name="userid"]');
      const p = document.querySelector('input[name="password"]');
      const b = document.querySelector('[data-action="coursemos_widgets_loginbar_templets_default_login_login"]');
      const univ = document.querySelector('.login_box[data-name="university"] li[data-value="1"]');
      if (u && p && b && !u.dataset.done) {
        u.dataset.done = "1";
        if (univ) univ.click();
        u.value = data.bbitsId || "";
        p.value = data.bbitsPw || "";
        b.click();
      }
    }

    if (host === "plato.pusan.ac.kr") {
      if (data.platoPopupClose) {
        document.querySelectorAll('.modal-dialog .close, .pop-close').forEach(c => c.click());
      }
      if (!data.popupToggle) return;
      if (document.querySelector('.logout')) return;
      const sel = [['#input-username', '#input-password', 'input[name="loginbutton"]'], ['input[name="username"]', 'input[name="password"]', 'input[name="loginbutton"]']];
      for (const [id, pw, btn] of sel) {
        const i = document.querySelector(id), p = document.querySelector(pw), b = document.querySelector(btn);
        if (i && p && b && !i.dataset.done) {
          i.dataset.done = "1";
          i.value = data.userId;
          p.value = data.userPw;
          b.click();
          break;
        }
      }
    }
  });
};

const fixVp = () => {
  const m = document.querySelector('meta[name="viewport"]');
  if (m && m.content !== "width=device-width, initial-scale=1") m.content = "width=device-width, initial-scale=1";
};

fixVp();
attemptLogin();
let t;
new MutationObserver(() => {
  clearTimeout(t);
  t = setTimeout(() => { attemptLogin(); fixVp(); }, 300);
}).observe(document.body, { childList: true, subtree: true });
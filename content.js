const attemptLogin = () => {
  if (!chrome.runtime?.id) return;
  try {
    const host = window.location.hostname;
    const href = window.location.href;
    const path = window.location.pathname;

    chrome.storage.local.get([
      "hjsId", "hjsPw", "hjsToggle", "hjsPopupClose",
      "userId", "userPw", "popupToggle", "platoPopupClose",
      "bbitsId", "bbitsPw", "bbitsToggle", "bbitsPopupClose"
    ], (data) => {
      if (!chrome.runtime?.id || chrome.runtime.lastError) return;
    
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
      // 1. 실제 공지 팝업/모달 자동 닫기 (배너나 링크 내부 버튼은 절대 클릭하지 않음)
      if (data.platoPopupClose) {
        const closeSelectors = [
          '.modal-dialog .btn-close',
          '.modal-dialog .close',
          '.modal .btn-close',
          '.modal .close',
          '.pop-close',
          '[data-bs-dismiss="modal"]'
        ];
        document.querySelectorAll(closeSelectors.join(', ')).forEach(c => {
          // 배너나 a 링크 내부의 닫기 버튼은 클릭하지 않음 (새 탭/창 열림 방지)
          if (c.closest('a, .banner, [target="_blank"]')) return;
          if (!c.dataset.autoClosed) {
            c.dataset.autoClosed = "1";
            c.click();
          }
        });
      }

      if (!data.popupToggle) return;

      // iframe 내부에서는 최상위 페이지의 로그인을 방해하지 않도록 중단
      if (window !== window.top) return;

      // 2. Moodle 로그인 후 중간 "리다이랙트" 안내 화면 자동 통과
      if (document.title.includes("리다이랙트") || document.querySelector('#region-main h1')?.innerText.includes("리다이랙트")) {
        const continueLink = document.querySelector('#region-main a[href*="plato.pusan.ac.kr"]');
        if (continueLink) {
          continueLink.click();
          return;
        }
      }

      // 3. 로그인 여부 판단
      const loginBtnOnPage = document.querySelector('a[href*="/login/index.php"]');
      const isNotLoggedIn = document.body.classList.contains('notloggedin') || !!loginBtnOnPage;
      const isLoggedIn = !isNotLoggedIn && (
        document.body.classList.contains('loggedin') ||
        !!document.querySelector('.logout, a[href*="/login/logout.php"], .usermenu, .userpicture')
      );

      // 4. 세션 만료 다이얼로그/모달 감지 및 재로그인 처리
      const sessionModal = document.querySelector('.moodle-dialogue, .modal.show, div[role="alertdialog"], div[role="dialog"]');
      if (sessionModal && !sessionModal.dataset.sessionHandled) {
        const modalText = sessionModal.innerText || "";
        if (/세션|만료|timeout|로그아웃|다시\s*로그인/i.test(modalText)) {
          sessionModal.dataset.sessionHandled = "1";
          const loginBtn = sessionModal.querySelector('a[href*="login"], button.btn-primary');
          if (loginBtn) {
            loginBtn.click();
            return;
          } else {
            window.location.href = "https://plato.pusan.ac.kr/login/index.php";
            return;
          }
        }
      }

      // 5. 로그인 페이지(https://plato.pusan.ac.kr/login/index.php)인 경우: 자동 로그인 수행
      if (path.includes("/login/index.php") || path.includes("/login/")) {
        // 실제 비밀번호 불일치 오류 메시지 감지 시 무한 루프 방지
        const errText = (document.querySelector('.alert, .loginerrors')?.innerText || "").trim();
        if (/잘못된|불일치|일치하지|아이디 또는 비밀번호|invalid/i.test(errText)) {
          return;
        }

        // 기본 활성 탭(교내 구성원 SSO 폼 #form-login-sso) 타겟팅
        const loginForm = document.querySelector('#form-login-sso') ||
                          document.querySelector('.tab-pane.active form') ||
                          document.querySelector('form.tab-content-container') ||
                          document.querySelector('form[action*="login"]');

        if (loginForm && !loginForm.dataset.autoLoggingIn) {
          const u = loginForm.querySelector('#input-username') || loginForm.querySelector('input[name="username"]');
          const p = loginForm.querySelector('#input-password') || loginForm.querySelector('input[name="password"]');
          const b = loginForm.querySelector('.btn-login') ||
                    loginForm.querySelector('button[name="loginbutton"]') ||
                    loginForm.querySelector('button[type="submit"]');

          if (u && p && b && data.userId && data.userPw) {
            loginForm.dataset.autoLoggingIn = "1";

            // 값 주입 및 Bouncer 유효성 검사기 통과용 이벤트 발생
            u.value = data.userId;
            u.dispatchEvent(new Event('input', { bubbles: true }));
            u.dispatchEvent(new Event('change', { bubbles: true }));
            u.dispatchEvent(new Event('blur', { bubbles: true }));

            p.value = data.userPw;
            p.dispatchEvent(new Event('input', { bubbles: true }));
            p.dispatchEvent(new Event('change', { bubbles: true }));
            p.dispatchEvent(new Event('blur', { bubbles: true }));

            // 단 1회 클릭으로 자연스러운 폼 제출 진행 (2차 중복 제출 절대 금지)
            setTimeout(() => {
              if (!b.disabled) {
                b.click();
              }
            }, 80);
            return;
          }
        }
      }

      // 6. 메인 페이지나 일반 페이지에서 비로그인 상태일 때 로그인 페이지로 즉시 자동 전환
      if (!isLoggedIn && isNotLoggedIn && data.userId && data.userPw) {
        if (!path.includes("/login/index.php") && !path.includes("/login/")) {
          if (!document.body.dataset.loginRedirecting) {
            document.body.dataset.loginRedirecting = "1";
            const loginUrl = (path === "/" || path === "/index.php" || path === "")
              ? "https://plato.pusan.ac.kr/login/index.php"
              : `https://plato.pusan.ac.kr/login/index.php?wantsurl=${encodeURIComponent(href)}`;
            window.location.href = loginUrl;
            return;
          }
        }
      }

      // 7. 로그인 완료 시 실패 플래그 정리
      if (isLoggedIn) {
        sessionStorage.removeItem('plato_login_failed');
      }
    }
  });
  } catch (err) {
    // 확장 프로그램 새로고침 등으로 컨텍스트가 만료된 경우 안전 종료
    return;
  }
};

const fixVp = () => {
  const m = document.querySelector('meta[name="viewport"]');
  if (m && m.content !== "width=device-width, initial-scale=1") m.content = "width=device-width, initial-scale=1";
};

fixVp();
attemptLogin();
let t;
const observer = new MutationObserver(() => {
  clearTimeout(t);
  t = setTimeout(() => {
    if (!chrome.runtime?.id) {
      observer.disconnect();
      return;
    }
    attemptLogin();
    fixVp();
  }, 300);
});
observer.observe(document.body, { childList: true, subtree: true });

// 세션 만료 감시를 위한 주기적 체크 (30초마다)
const checkInterval = setInterval(() => {
  if (!chrome.runtime?.id) {
    clearInterval(checkInterval);
    return;
  }
  attemptLogin();
}, 30000);
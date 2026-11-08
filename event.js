window.addEventListener("RUN_PNU_FUNC", (e) => {
  const type = e.detail?.type;
  const fn = type === 'ONESTOP_SSO' && typeof ssoOpen === 'function' ? ssoOpen :
    type === 'CHANGE_PW' && typeof changeNextPw === 'function' ? changeNextPw : null;
  if (!fn) return;
  try {
    fn();
    window.dispatchEvent(new CustomEvent('PNU_FUNC_RESULT', { detail: `${type}:invoked` }));
  } catch (_) {
    // Do not expose the site's exception, which may contain authentication URLs.
    window.dispatchEvent(new CustomEvent('PNU_FUNC_RESULT', { detail: `${type}:failed` }));
  }
});

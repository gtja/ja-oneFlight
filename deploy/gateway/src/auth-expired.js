import { clearIdentity, parentOrigin, report, showStatus } from './storage.js';
history.replaceState(null, '', location.pathname);
void (async () => {
  const origin = parentOrigin(window.__ONEFLIGHT_EMBED_CONFIG__?.parentOrigin, window.__ONEFLIGHT_EMBED_CONFIG__?.transportMode);
  try { await clearIdentity(); } finally {
    showStatus('飞控认证已失效，请从平台重新进入', true);
    const loggedOut = sessionStorage.getItem('oneflight-native-logout') === '1';
    sessionStorage.removeItem('oneflight-native-logout');
    report(origin, loggedOut ? 'LOGGED_OUT' : 'AUTH_EXPIRED', '飞控认证已失效，请重新登录');
  }
})();

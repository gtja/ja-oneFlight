import { clearIdentity, namespace, parentOrigin, report, tokenStorage, showStatus } from './storage.js';

const integration = window.__ONEFLIGHT_EMBED_CONFIG__;
const origin = parentOrigin(integration?.parentOrigin, integration?.transportMode);
const nativeView = integration?.view === 'native';
// This classic script runs at </head>, before the source module entry executes.
// The source supports postConfig overrides after fetching its remote system config.
const expiredUrl = `${location.origin}/__oneflight/auth-expired`;
const transportOverrides = integration?.transportMode === 'http-ip' ? { globalWs: 'ws' } : {};
window.config = { ...(window.config || {}), ...transportOverrides, loginUrl: expiredUrl };
window.postConfig = { ...(window.postConfig || {}), ...transportOverrides, loginUrl: expiredUrl };
let disposed = false;
let ready = false;
let failed = false;
let logoutPending;
let lastHeader;
let scheduled = false;
let missingAnchorTimer;

function failure(message, type = 'ADAPTER_ERROR') {
  if (failed || disposed) return;
  failed = true;
  document.documentElement.classList.remove('oneflight-adapting');
  showStatus(message, true);
  report(origin, type, message);
}

window.addEventListener('message', (event) => {
  if (event.origin !== origin || event.source !== window.parent || event.data?.namespace !== namespace || event.data?.type !== 'LOGOUT') return;
  logoutPending ||= clearIdentity().then(() => {
    report(origin, 'LOGGED_OUT');
    showStatus('飞控已退出');
  }).catch(() => failure('飞控登录存储清理失败，请关闭页面后重试'));
});

// Observe status only, never request bodies, headers or personal tokens.
function observeRequest(url, status) {
  let path;
  try { path = new URL(url, location.origin).pathname; } catch { return; }
  if (!path.startsWith('/proxyApi/')) return;
  if (path.endsWith('/login/logout')) {
    sessionStorage.setItem('oneflight-native-logout', '1');
  } else if (status === 401) {
    void clearIdentity().finally(() => failure('飞控认证已失效，请重新登录', 'AUTH_EXPIRED'));
  }
}
const nativeFetch = window.fetch?.bind(window);
if (nativeFetch) window.fetch = async (...args) => {
  const response = await nativeFetch(...args);
  observeRequest(typeof args[0] === 'string' ? args[0] : args[0]?.url, response.status);
  return response;
};
const nativeOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url, ...rest) {
  this.addEventListener('loadend', () => observeRequest(String(url), this.status), { once: true });
  return nativeOpen.call(this, method, url, ...rest);
};

function resize() {
  window.dispatchEvent(new Event('resize'));
  document.querySelectorAll('video').forEach((video) => video.dispatchEvent(new Event('resize')));
}

async function reportReady() {
  if (disposed || failed || logoutPending || ready) return;
  try {
    const tokenPresent = await tokenStorage.getItem('token');
    if (disposed || failed || logoutPending || ready) return;
    if (!tokenPresent) {
      failure('飞控登录状态已失效，请重新进入', 'AUTH_EXPIRED');
      return;
    }
    ready = true;
    report(origin, 'READY');
  } catch {
    failure('飞控登录存储读取失败，请允许该站点使用浏览器存储');
  }
}

async function adapt() {
  if (disposed || failed || logoutPending) return;
  if (!location.pathname.startsWith('/control-room')) {
    failure('飞控已离开控制室，请从平台重新进入');
    return;
  }
  const anchors = document.querySelectorAll('#app-header-center');
  if (anchors.length !== 1) {
    if (anchors.length > 1) failure('飞控标题栏结构不唯一，页面适配失败');
    else if (ready && !missingAnchorTimer) missingAnchorTimer = setTimeout(() => {
      if (document.querySelectorAll('#app-header-center').length !== 1) {
        failure('飞控页面结构已变化，导航适配失效，请联系管理员');
      }
      missingAnchorTimer = undefined;
    }, 1500);
    return;
  }
  clearTimeout(missingAnchorTimer);
  missingAnchorTimer = undefined;
  const header = anchors[0].closest('header');
  const layout = header?.parentElement;
  const root = document.getElementById('root');
  if (!header || !layout || !root?.contains(header) || !layout.querySelector('main')) {
    failure('飞控页面结构已变化，导航适配失败，请联系管理员');
    return;
  }
  const content = [...layout.children].find((element) => element !== header && element.querySelector('main'));
  if (!content) {
    failure('飞控工作区结构已变化，请联系管理员');
    return;
  }
  const main = content.querySelector('main');
  // Only the source shell nav beside main; never a control panel inside main.
  [...main.parentElement.children].filter((element) => element.tagName === 'NAV').forEach((nav) => {
    nav.dataset.oneflightGlobalNavigation = '';
  });
  if (lastHeader !== header) {
    header.dataset.oneflightGlobalHeader = '';
    layout.dataset.oneflightLayout = '';
    content.dataset.oneflightContent = '';
    lastHeader = header;
    document.documentElement.classList.add('oneflight-embedded');
    document.documentElement.classList.remove('oneflight-adapting');
    requestAnimationFrame(resize);
    setTimeout(resize, 150);
  }
  await reportReady();
}
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => { scheduled = false; void adapt(); });
}
if (nativeView) {
  // Native view keeps the source's own routes, shell and layout. READY acknowledges
  // the document and child identity only; device status remains the source's data.
  const onDocumentReady = () => { void reportReady(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onDocumentReady, { once: true });
  else onDocumentReady();
  window.addEventListener('pagehide', () => {
    disposed = true;
    document.removeEventListener('DOMContentLoaded', onDocumentReady);
  });
} else {
  document.documentElement.classList.add('oneflight-adapting');
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('pagehide', () => { disposed = true; observer.disconnect(); clearTimeout(missingAnchorTimer); });
  window.addEventListener('resize', () => {
    document.querySelectorAll('video').forEach((video) => video.dispatchEvent(new Event('resize')));
  });
  document.addEventListener('fullscreenchange', () => requestAnimationFrame(resize));
  setTimeout(() => {
    if (!ready && !failed) failure('未找到已验证的飞控标题栏，页面适配失败，请联系管理员');
  }, 20000);
  schedule();
}

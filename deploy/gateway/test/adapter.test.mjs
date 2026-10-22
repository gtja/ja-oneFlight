import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { establishIdentity } from '../src/bootstrap-flow.js';
const adapter = (await build({ entryPoints: ['src/adapter.js'], bundle: true, format: 'iife', write: false })).outputFiles[0].text;
const expired = (await build({ entryPoints: ['src/auth-expired.js'], bundle: true, format: 'iife', write: false })).outputFiles[0].text;
const storage = (await build({ stdin: { contents: "import { tokenStorage, clearIdentity } from './src/storage.js'; window.testStorage = tokenStorage; window.testClearIdentity = clearIdentity;", resolveDir: process.cwd() }, bundle: true, format: 'iife', write: false })).outputFiles[0].text;
const wait = (ms = 70) => new Promise((resolve) => setTimeout(resolve, ms));
async function fixture(path = '/control-room/uav/id', http = false, view) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"><div id="shell"><header><div id="app-header-center"></div></header><div><div><nav id="global-nav"></nav><main><nav id="device-controls"></nav><video></video></main></div></div></div></div></body></html>', { url: `${http ? 'http://192.0.2.10:8089' : 'https://flight.example'}${path}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.indexedDB = indexedDB;
  window.IDBKeyRange = IDBKeyRange;
  window.structuredClone = structuredClone;
  window.eval(storage);
  await window.testStorage.setItem('token', 'person-B');
  const messages = [];
  const parent = { postMessage: (data, origin) => messages.push({ data, origin }) };
  Object.defineProperty(window, 'parent', { value: parent });
  window.__ONEFLIGHT_EMBED_CONFIG__ = http
    ? { parentOrigin: 'http://192.0.2.10:8088', transportMode: 'http-ip' }
    : { parentOrigin: 'https://oneflight.example' };
  if (view) window.__ONEFLIGHT_EMBED_CONFIG__.view = view;
  window.config = { loginUrl: 'https://4a.example/login', systemName: 'jingqi' };
  return { dom, window, parent, messages };
}
test('adapter hides only anchored shell header and sibling global navigation', async () => {
  const f = await fixture();
  try {
    f.window.eval(adapter);
    await wait();
    assert.equal(f.window.document.querySelector('header').dataset.oneflightGlobalHeader, '');
    assert.equal(f.window.document.querySelector('#global-nav').dataset.oneflightGlobalNavigation, '');
    assert.equal(f.window.document.querySelector('#device-controls').hasAttribute('data-oneflight-global-navigation'), false);
    assert.equal(f.window.config.loginUrl, 'https://flight.example/__oneflight/auth-expired');
    assert.equal(f.window.postConfig.loginUrl, f.window.config.loginUrl);
  } finally { f.window.dispatchEvent(new f.window.Event('pagehide')); f.window.close(); }
});

test('native view keeps source routes, header, navigation and layout without an anchor requirement', async () => {
  const f = await fixture('/source/UAV_AIRPORT', true, 'native');
  try {
    f.window.document.querySelector('#app-header-center').remove();
    const before = f.window.document.getElementById('root').outerHTML;
    f.window.eval(adapter);
    await wait();
    assert.equal(f.window.document.getElementById('root').outerHTML, before);
    assert.equal(f.window.document.documentElement.className, '');
    assert.equal(f.window.config.globalWs, 'ws');
    assert.equal(f.window.postConfig.globalWs, 'ws');
    assert.equal(f.window.config.loginUrl, 'http://192.0.2.10:8089/__oneflight/auth-expired');
    assert.equal(f.messages.filter((m) => m.data.type === 'READY').length, 1);
    assert.equal(f.messages[0].origin, 'http://192.0.2.10:8088');
    assert.equal(JSON.stringify(f.messages).includes('person-B'), false);
    f.window.document.querySelector('header').remove();
    await wait();
    assert.equal(f.messages.some((m) => m.data.type === 'ADAPTER_ERROR'), false);
  } finally { f.window.dispatchEvent(new f.window.Event('pagehide')); f.window.close(); }
});

test('native readiness waits for DOMContentLoaded and refuses a missing child identity', async () => {
  const f = await fixture('/source/UAV_AIRPORT', false, 'native');
  try {
    Object.defineProperty(f.window.document, 'readyState', { value: 'loading', configurable: true });
    f.window.eval(adapter);
    await wait();
    assert.equal(f.messages.length, 0);
    await f.window.testStorage.removeItem('token');
    f.window.document.dispatchEvent(new f.window.Event('DOMContentLoaded'));
    await wait();
    assert.equal(f.messages.at(-1).data.type, 'AUTH_EXPIRED');
    assert.equal(f.messages.some((m) => m.data.type === 'READY'), false);
  } finally { f.window.dispatchEvent(new f.window.Event('pagehide')); f.window.close(); }
});

test('native view retains exact parent logout and expires on source HTTP authentication failures', async () => {
  const f = await fixture('/source/UAV_AIRPORT', true, 'native');
  try {
    f.window.fetch = async () => ({ status: 401 });
    f.window.eval(adapter);
    await wait();
    await f.window.fetch('/proxyApi/otherService/jingqi/dushuBackend/devices');
    await wait();
    assert.equal(f.messages.at(-1).data.type, 'AUTH_EXPIRED');
    assert.equal(await f.window.testStorage.getItem('token'), null);
    assert.equal(JSON.stringify(f.messages).includes('person-B'), false);
  } finally { f.window.dispatchEvent(new f.window.Event('pagehide')); f.window.close(); }
  const logout = await fixture('/source/UAV_AIRPORT', true, 'native');
  try {
    logout.window.eval(adapter);
    await wait();
    logout.window.dispatchEvent(new logout.window.MessageEvent('message', { origin: 'http://192.0.2.10:8088', source: {}, data: { namespace: 'oneflight:flight-control', type: 'LOGOUT' } }));
    await wait();
    assert.equal(logout.messages.some((m) => m.data.type === 'LOGGED_OUT'), false);
    logout.window.dispatchEvent(new logout.window.MessageEvent('message', { origin: 'http://192.0.2.10:8088', source: logout.parent, data: { namespace: 'oneflight:flight-control', type: 'LOGOUT' } }));
    await wait();
    assert.equal(logout.messages.at(-1).data.type, 'LOGGED_OUT');
    assert.equal(await logout.window.testStorage.getItem('token'), null);
  } finally { logout.window.dispatchEvent(new logout.window.Event('pagehide')); logout.window.close(); }
});

test('native logout clears only source identity cookies and preserves platform session and preferences', async () => {
  const f = await fixture('/source/UAV_AIRPORT', false, 'native');
  try {
    for (const [name, value] of [['access_token', 'source-person-A'], ['username', 'person-A'], ['ONEFLIGHTSESSION', 'platform-session'], ['locale', 'zh-CN']]) {
      f.window.document.cookie = `${name}=${value}; Path=/; SameSite=Lax; Secure`;
    }
    f.window.localStorage.setItem('username', 'person-A');
    f.window.eval(adapter);
    await wait();
    f.window.dispatchEvent(new f.window.MessageEvent('message', { origin: 'https://oneflight.example', source: f.parent, data: { namespace: 'oneflight:flight-control', type: 'LOGOUT' } }));
    await wait();
    const cookies = f.window.document.cookie;
    assert.equal(cookies.includes('access_token='), false);
    assert.equal(cookies.includes('username='), false);
    assert.equal(cookies.includes('ONEFLIGHTSESSION=platform-session'), true);
    assert.equal(cookies.includes('locale=zh-CN'), true);
    assert.equal(f.window.localStorage.getItem('username'), null);
    assert.equal(await f.window.testStorage.getItem('token'), null);
  } finally { f.window.dispatchEvent(new f.window.Event('pagehide')); f.window.close(); }
});

test('account switch removes the old native cookie identity before storing the next user token', async () => {
  const f = await fixture();
  try {
    f.window.document.cookie = 'access_token=source-person-A; Path=/; SameSite=Lax; Secure';
    f.window.document.cookie = 'username=person-A; Path=/; SameSite=Lax; Secure';
    f.window.document.cookie = 'ONEFLIGHTSESSION=platform-session; Path=/; SameSite=Lax; Secure';
    f.window.localStorage.setItem('username', 'person-A');
    let navigated = false;
    await establishIdentity({ mode: 'bootstrap', token: 'source-person-B', targetPath: '/control-room' }, {
      clear: f.window.testClearIdentity,
      store: async (key, value) => {
        assert.equal(f.window.document.cookie.includes('access_token='), false);
        assert.equal(f.window.document.cookie.includes('username='), false);
        assert.equal(f.window.document.cookie.includes('ONEFLIGHTSESSION=platform-session'), true);
        assert.equal(f.window.localStorage.getItem('username'), null);
        assert.equal(await f.window.testStorage.getItem('token'), null);
        await f.window.testStorage.setItem(key, value);
      },
      navigate: () => { navigated = true; },
    });
    assert.equal(navigated, true);
    assert.equal(await f.window.testStorage.getItem('token'), 'source-person-B');
  } finally { f.window.dispatchEvent(new f.window.Event('pagehide')); f.window.close(); }
});
test('logout ignores forged messages and clears identity only for exact parent/source', async () => {
  const f = await fixture();
  try {
    f.window.eval(adapter);
    f.window.dispatchEvent(new f.window.MessageEvent('message', { origin: 'https://evil.example', source: f.parent, data: { namespace: 'oneflight:flight-control', type: 'LOGOUT' } }));
    f.window.dispatchEvent(new f.window.MessageEvent('message', { origin: 'https://oneflight.example', source: {}, data: { namespace: 'oneflight:flight-control', type: 'LOGOUT' } }));
    await wait();
    assert.equal(f.messages.some((m) => m.data.type === 'LOGGED_OUT'), false);
    f.window.dispatchEvent(new f.window.MessageEvent('message', { origin: 'https://oneflight.example', source: f.parent, data: { namespace: 'oneflight:flight-control', type: 'LOGOUT' } }));
    await wait();
    assert.equal(f.messages.some((m) => m.data.type === 'LOGGED_OUT' && m.origin === 'https://oneflight.example'), true);
    assert.equal(JSON.stringify(f.messages).includes('person-B'), false);
  } finally { f.window.dispatchEvent(new f.window.Event('pagehide')); f.window.close(); }
});
test('missing/changed structural anchor produces an explicit error instead of pixel cropping', async () => {
  const f = await fixture();
  try {
    f.window.document.querySelector('#app-header-center').id = 'renamed';
    const timers = [];
    f.window.setTimeout = (fn, delay) => { timers.push({ fn, delay }); return 1; };
    f.window.eval(adapter);
    timers.find((t) => t.delay === 20000).fn();
    await wait();
    assert.equal(f.messages.at(-1).data.type, 'ADAPTER_ERROR');
    assert.match(f.window.document.body.textContent, /适配失败/);
  } finally { f.window.dispatchEvent(new f.window.Event('pagehide')); f.window.close(); }
});
test('auth status route reports expiration and never navigates to 4A', async () => {
  const f = await fixture('/__oneflight/auth-expired?fallback=ignored');
  try {
    f.window.eval(expired);
    await wait();
    assert.equal(f.window.location.search, '');
    assert.equal(f.messages.at(-1).data.type, 'AUTH_EXPIRED');
    assert.equal(f.window.location.origin, 'https://flight.example');
  } finally { f.window.dispatchEvent(new f.window.Event('pagehide')); f.window.close(); }
});

test('anchor removed after READY fails visibly after remount grace period', async () => {
  const f = await fixture();
  try {
    f.window.eval(adapter);
    await wait();
    assert.equal(f.messages.some((m) => m.data.type === 'READY'), true);
    f.window.document.querySelector('header').remove();
    await wait(1600);
    assert.equal(f.messages.at(-1).data.type, 'ADAPTER_ERROR');
    assert.match(f.window.document.body.textContent, /导航适配失效/);
  } finally { f.window.dispatchEvent(new f.window.Event('pagehide')); f.window.close(); }
});

test('HTTP IP adapter preserves exact origins and sends browser WebSocket over the child HTTP port', async () => {
  const f = await fixture('/control-room/uav/id', true);
  try {
    f.window.eval(adapter);
    await wait();
    assert.equal(f.window.config.globalWs, 'ws');
    assert.equal(f.window.postConfig.globalWs, 'ws');
    assert.equal(f.window.config.loginUrl, 'http://192.0.2.10:8089/__oneflight/auth-expired');
    assert.equal(f.messages.some((m) => m.data.type === 'READY' && m.origin === 'http://192.0.2.10:8088'), true);
    f.window.dispatchEvent(new f.window.MessageEvent('message', { origin: 'http://192.0.2.10:8089', source: f.parent, data: { namespace: 'oneflight:flight-control', type: 'LOGOUT' } }));
    await wait();
    assert.equal(f.messages.some((m) => m.data.type === 'LOGGED_OUT'), false);
  } finally { f.window.dispatchEvent(new f.window.Event('pagehide')); f.window.close(); }
});

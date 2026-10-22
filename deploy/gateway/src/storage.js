import localforage from 'localforage';

// The upstream default instance reads this exact database, store and string key.
// Do not import the upstream application: its modules execute auth/navigation.
export const tokenStorage = localforage.createInstance({
  name: 'localforage', storeName: 'keyvaluepairs',
  driver: [localforage.INDEXEDDB, localforage.WEBSQL, localforage.LOCALSTORAGE],
});
export const namespace = 'oneflight:flight-control';

export function parentOrigin(value, transportMode = 'https') {
  const parsed = new URL(value);
  if (parsed.origin !== value || parsed.username || parsed.password) throw new Error('父页面地址配置无效');
  if (transportMode === 'http-ip') {
    const octets = parsed.hostname.split('.');
    if (parsed.protocol !== 'http:' || location.protocol !== 'http:' || octets.length !== 4 ||
        octets.some((part) => !/^(0|[1-9][0-9]{0,2})$/.test(part) || Number(part) > 255) ||
        parsed.hostname !== location.hostname || parsed.origin === location.origin) throw new Error('HTTP 飞控地址配置无效');
  } else if (transportMode !== 'https' || parsed.protocol !== 'https:') throw new Error('父页面地址配置无效');
  return parsed.origin;
}

export function report(origin, type, message) {
  if (window.parent === window) return;
  window.parent.postMessage({ namespace, type, ...(message ? { message } : {}) }, origin);
}

export async function clearIdentity() {
  await tokenStorage.removeItem('token');
  // The source derives this display-only key after verifying the new token.
  localStorage.removeItem('username');
  // Source IC writes these host-only cookies at Path=/. Ports do not isolate
  // cookies, so only native identity keys may be removed on a shared IP host.
  for (const name of ['access_token', 'username']) {
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  }
}

export function showStatus(message, error = false) {
  const box = document.createElement('div');
  box.className = 'oneflight-integration-status';
  box.setAttribute('role', error ? 'alert' : 'status');
  box.textContent = message;
  const mount = () => { document.body.replaceChildren(box); };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
}

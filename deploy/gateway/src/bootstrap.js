import { establishIdentity } from './bootstrap-flow.js';
import { clearIdentity, parentOrigin, report, showStatus, tokenStorage } from './storage.js';

// Remove the bearer ticket before awaiting storage or requesting upstream assets.
history.replaceState(null, '', location.pathname);

async function bootstrap() {
  const element = document.getElementById('oneflight-bootstrap');
  let origin;
  try {
    const config = JSON.parse(element?.textContent || '{}');
    element?.remove();
    origin = parentOrigin(config.parentOrigin, config.transportMode);
    if (config.mode === 'error') {
      showStatus(config.message || '飞控启动失败，请重新进入', true);
      report(origin, 'ADAPTER_ERROR', config.message || '飞控启动失败，请重新进入');
      return;
    }
    if (config.mode === 'logout') {
      await clearIdentity();
      showStatus('飞控登录存储已清理');
      report(origin, 'LOGGED_OUT');
      return;
    }
    await establishIdentity(config, {
      clear: clearIdentity,
      store: (key, value) => tokenStorage.setItem(key, value),
      navigate: (path) => location.replace(path),
    });
  } catch {
    showStatus('飞控登录存储建立失败，请重新进入；请允许该站点使用浏览器存储', true);
    if (origin) report(origin, 'ADAPTER_ERROR', '飞控登录存储建立失败，请重新进入');
  }
}
void bootstrap();

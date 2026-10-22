import { parentOrigin, report } from './storage.js';

// A denied new document must not clear identity or cookies: an already open
// operational tab may still be using the same source login and entry grant.
const message = '飞控入口未放行，请返回平台重新选择任务并检查业务条件';
try {
  const config = window.__ONEFLIGHT_EMBED_CONFIG__;
  const origin = parentOrigin(config?.parentOrigin, config?.transportMode);
  const link = document.getElementById('oneflight-return');
  if (link) {
    link.href = `${origin}/?view=flight`;
    link.target = '_top';
    link.rel = 'noreferrer';
    link.hidden = false;
  }
  report(origin, 'ENTRY_DENIED', message);
} catch {
  // No user-supplied or unvalidated redirect is offered if config is invalid.
}

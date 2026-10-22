import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
const validation = (await build({ stdin: { contents: "import { parentOrigin } from './src/storage.js'; window.validateParent = parentOrigin;", resolveDir: process.cwd() }, bundle: true, format: 'iife', write: false })).outputFiles[0].text;
function check(parent, mode, child = 'http://192.0.2.10:8089') {
  const dom = new JSDOM('<!doctype html>', { url: child, runScripts: 'outside-only' });
  try { dom.window.eval(validation); return dom.window.validateParent(parent, mode); }
  finally { dom.window.close(); }
}
test('HTTP literal IPv4 parent is allowed only in explicitly enabled compatibility mode', () => {
  assert.equal(check('http://192.0.2.10:8088', 'http-ip'), 'http://192.0.2.10:8088');
  assert.equal(check('http://192.0.2.10', 'http-ip'), 'http://192.0.2.10');
  assert.throws(() => check('http://192.0.2.10:8088'));
});
for (const parent of ['http://other.example:8088', 'http://192.0.2.11:8088', 'http://192.0.2.10:8089', 'http://192.0.2.10:8088/', 'http://192.0.2.10:80', 'http://name@192.0.2.10:8088', 'https://192.0.2.10:8088']) {
  test(`HTTP compatibility rejects an unexpected parent ${parent}`, () => assert.throws(() => check(parent, 'http-ip')));
}
test('native source proxy forwards only native authentication cookies and retains TLS validation', async () => {
  const source = await readFile('nginx/flight-locations.conf.template', 'utf8');
  assert.match(source, /proxy_set_header Cookie "access_token=\$cookie_access_token; username=\$cookie_username";/);
  assert.doesNotMatch(source, /\$http_cookie|\$cookie_ONEFLIGHTSESSION|\$cookie_JSESSIONID/);
  assert.match(source, /proxy_hide_header Set-Cookie;/);
  assert.match(source, /proxy_ssl_verify on;/);
  assert.match(source, /proxy_set_header Origin \$oneflight_source_origin;/);
  assert.match(source, /proxy_pass https:\/\//);
  assert.doesNotMatch(source, /proxy_cookie_domain/);
});
test('HTTP gateway has no certificate or HSTS dependency and restricts Host on both ports', async () => {
  const source = await readFile('nginx/gateway-http.conf.template', 'utf8');
  assert.doesNotMatch(source, /ssl_certificate|Strict-Transport-Security/);
  assert.equal((source.match(/if \(\$http_host !=/g) || []).length, 2);
  assert.match(source, /ONEFLIGHT_HTTP_LISTEN_PORT/);
  assert.match(source, /FLIGHT_HTTP_LISTEN_PORT/);
});

test('source DNS is deferred and connect pins preserve source certificate and Host identity', async () => {
  const source = await readFile('nginx/flight-locations.conf.template', 'utf8');
  const entrypoint = await readFile('entrypoint.sh', 'utf8');
  assert.match(source, /set \$oneflight_dushu_connect \$\{DUSHU_CONNECT_TARGET\};/);
  assert.match(source, /proxy_pass https:\/\/\$oneflight_dushu_connect;/);
  assert.match(source, /proxy_set_header Host \$\{DUSHU_UPSTREAM_HOST\}:\$\{DUSHU_UPSTREAM_PORT\};/);
  assert.match(source, /proxy_ssl_name \$\{DUSHU_UPSTREAM_HOST\};/);
  assert.match(source, /proxy_ssl_verify on;/);
  assert.match(entrypoint, /SOURCE_GATEWAY_PINNED_IP/);
  assert.match(entrypoint, /resolver_timeout 2s/);
  assert.match(entrypoint, /\/etc\/resolv\.conf/);
});

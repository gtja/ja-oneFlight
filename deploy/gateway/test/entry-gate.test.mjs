import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const execute = promisify(execFile);
const deniedScript = (await build({ entryPoints: ['src/entry-denied.js'], bundle: true, format: 'iife', write: false })).outputFiles[0].text;

test('entry denial keeps the operational identity and offers only the validated platform return', async () => {
  const dom = new JSDOM(await readFile('public/entry-denied.html', 'utf8'), { url: 'http://192.0.2.10:8089/source/UAV_AIRPORT', runScripts: 'outside-only' });
  try {
    dom.window.__ONEFLIGHT_EMBED_CONFIG__ = { parentOrigin: 'http://192.0.2.10:8088', transportMode: 'http-ip' };
    dom.window.localStorage.setItem('username', 'operator');
    dom.window.document.cookie = 'access_token=fake-operational-token; Path=/';
    dom.window.eval(deniedScript);
    const link = dom.window.document.getElementById('oneflight-return');
    assert.equal(link.href, 'http://192.0.2.10:8088/?view=flight');
    assert.equal(link.target, '_top');
    assert.equal(link.hidden, false);
    assert.equal(dom.window.localStorage.getItem('username'), 'operator');
    assert.match(dom.window.document.cookie, /access_token=fake-operational-token/);
  } finally { dom.window.close(); }
});

test('entry denial cannot redirect to a forged parent', async () => {
  const dom = new JSDOM(await readFile('public/entry-denied.html', 'utf8'), { url: 'http://192.0.2.10:8089/', runScripts: 'outside-only' });
  try {
    dom.window.__ONEFLIGHT_EMBED_CONFIG__ = { parentOrigin: 'https://evil.example', transportMode: 'http-ip' };
    dom.window.eval(deniedScript);
    const link = dom.window.document.getElementById('oneflight-return');
    assert.equal(link.hidden, true);
    assert.equal(link.hasAttribute('href'), false);
  } finally { dom.window.close(); }
});

test('only the trusted bootstrap/logout BFF may pass entry-grant Set-Cookie', async () => {
  const bff = await readFile('nginx/bff.conf.template', 'utf8');
  const flight = await readFile('nginx/flight-locations.conf.template', 'utf8');
  assert.doesNotMatch(bff, /proxy_hide_header Set-Cookie;/);
  assert.equal((flight.match(/include \$\{NGINX_RUNTIME_DIR\}\/oneflight-bff\.conf;/g) || []).length, 2);
  assert.match(flight, /location = \/__oneflight\/gateway-check \{\s+internal;/);
  assert.match(flight, /proxy_pass_request_body off;/);
  assert.match(flight, /proxy_set_header Content-Length '';/);
  assert.match(flight, /auth_request \/__oneflight\/gateway-check;/);
  assert.match(flight, /proxy_set_header X-Oneflight-Entry-Grant '';/);
  assert.match(flight, /proxy_set_header X-Oneflight-Request-Kind '';/);
});

// This optional isolated Nginx test uses only fake identities and loopback
// upstreams in a network-disabled throwaway container. No device is contacted.
test('real Nginx entry gate distinguishes documents from existing API/WS continuations', {
  skip: process.env.ONEFLIGHT_GATEWAY_NGINX_TEST !== '1', timeout: 60000,
}, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'oneflight-gateway-entry-test-'));
  const name = `oneflight-entry-test-${process.pid}-${Date.now()}`;
  let started = false;
  try {
    await mkdir(join(directory, 'public'));
    await cp('public', join(directory, 'public'), { recursive: true });
    const values = {
      NGINX_RUNTIME_DIR: '/test', ONEFLIGHT_API_UPSTREAM: '127.0.0.1:8090',
      ONEFLIGHT_PUBLIC_ORIGIN: 'http://127.0.0.1:8088', FLIGHT_CONTROL_ORIGIN: 'http://127.0.0.1:8089',
      FLIGHT_CONTROL_GATEWAY_SECRET: 'synthetic-gateway-secret-for-entry-test',
      DUSHU_CONNECT_TARGET: '127.0.0.1:8091', DUSHU_UPSTREAM_HOST: 'source.invalid', DUSHU_UPSTREAM_PORT: '443', DUSHU_TARGET_HOST: 'source.invalid:443',
    };
    const render = (source) => source.replace(/\$\{([A-Z_]+)\}/g, (_, key) => { assert.ok(Object.hasOwn(values, key), key); return values[key]; });
    const maps = await readFile('nginx/entry-maps.conf.template', 'utf8');
    const locations = render(await readFile('nginx/flight-locations.conf.template', 'utf8'))
      .replace('proxy_pass https://$oneflight_dushu_connect;', 'proxy_pass http://127.0.0.1:8091;');
    await writeFile(join(directory, 'flight.conf'), locations);
    await writeFile(join(directory, 'oneflight-bff.conf'), render(await readFile('nginx/bff.conf.template', 'utf8')));
    await writeFile(join(directory, 'nginx.conf'), `
      worker_processes 1; pid /tmp/oneflight-entry-test.pid; error_log /dev/stderr;
      events { worker_connections 64; }
      http {
        access_log off; include /etc/nginx/mime.types;
        client_body_temp_path /tmp/oneflight-entry-client;
        proxy_temp_path /tmp/oneflight-entry-proxy;
        fastcgi_temp_path /tmp/oneflight-entry-fastcgi;
        uwsgi_temp_path /tmp/oneflight-entry-uwsgi;
        scgi_temp_path /tmp/oneflight-entry-scgi;
        map $http_upgrade $connection_upgrade { default upgrade; '' close; }
        map $http_origin $oneflight_source_origin { default 'https://source.invalid'; }
        ${maps}
        map "$http_x_oneflight_entry_grant|$http_x_oneflight_request_kind" $test_authorization {
          default denied; ~^active\\| allowed; "expired|continue" allowed;
          "expired|entry" forbidden; "blocked|continue" forbidden; ~^unavailable\\| unavailable;
        }
        server { listen 8089; include /test/flight.conf; }
        server { listen 8090;
          location = /api/v1/flight-control/gateway-check {
            if ($http_x_oneflight_gateway_secret != 'synthetic-gateway-secret-for-entry-test') { return 401; }
            if ($test_authorization = allowed) { return 204; }
            if ($test_authorization = forbidden) { return 403; }
            if ($test_authorization = unavailable) { return 500; }
            return 401;
          }
          location = /api/v1/flight-control/bootstrap {
            add_header Set-Cookie 'ONEFLIGHT_ENTRY=active; HttpOnly; Path=/; SameSite=Lax' always;
            return 200 'bootstrap';
          }
          location = /api/v1/flight-control/logout-page {
            add_header Set-Cookie 'ONEFLIGHT_ENTRY=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax' always;
            return 200 '$http_x_oneflight_entry_grant';
          }
        }
        server { listen 8091;
          add_header Set-Cookie 'native_should_not_escape=fake' always;
          location / { default_type application/json;
            return 200 '{"cookie":"$http_cookie","grant":"$http_x_oneflight_entry_grant","secret":"$http_x_oneflight_gateway_secret","kind":"$http_x_oneflight_request_kind"}';
          }
        }
      }
    `);
    await execute('docker', ['run', '--rm', '--network', 'none',
      '--mount', `type=bind,src=${directory},dst=/test,readonly`, '--entrypoint', 'nginx',
      process.env.ONEFLIGHT_GATEWAY_TEST_IMAGE || 'oneflight:http-ip-compat', '-p', '/tmp/', '-e', '/dev/stderr', '-t', '-c', '/test/nginx.conf']);
    await execute('docker', ['run', '--rm', '-d', '--name', name, '--network', 'none',
      '--mount', `type=bind,src=${directory},dst=/test,readonly`, '--entrypoint', 'nginx',
      process.env.ONEFLIGHT_GATEWAY_TEST_IMAGE || 'oneflight:http-ip-compat', '-p', '/tmp/', '-e', '/dev/stderr', '-c', '/test/nginx.conf', '-g', 'daemon off;']);
    started = true;
    const request = async (path, headers = {}) => {
      const args = ['exec', name, 'curl', '--silent', '--show-error', '--max-time', '5', '-i'];
      for (const [key, value] of Object.entries(headers)) args.push('-H', `${key}: ${value}`);
      args.push(`http://127.0.0.1:8089${path}`);
      const { stdout } = await execute('docker', args);
      const split = stdout.indexOf('\r\n\r\n');
      return { status: Number(stdout.match(/^HTTP\/\S+ (\d+)/)?.[1]), headers: stdout.slice(0, split), body: stdout.slice(split + 4) };
    };
    await t.test('old native cookies alone cannot open documents or source APIs', async () => {
      const headers = { Cookie: 'access_token=fake-native; username=operator' };
      const document = await request('/source/UAV_AIRPORT', headers);
      assert.equal(document.status, 401); assert.match(document.body, /飞控入口未放行/);
      const api = await request('/proxyApi/devices', headers);
      assert.equal(api.status, 401); assert.equal(api.body, '');
    });
    await t.test('business-expired grant still continues API, assets, media and WebSocket transport', async () => {
      for (const path of ['/assets/native.js', '/proxyApi/device/status', '/proxyWsApi/otherService/jingqi/dushuBackend/ws', '/live/camera.flv']) {
        const response = await request(path, { Cookie: 'ONEFLIGHT_ENTRY=expired', Accept: '*/*' });
        assert.equal(response.status, 200, path);
      }
    });
    await t.test('fresh SPA/document navigation rechecks business even with forged continuation headers', async () => {
      for (const [path, headers] of [
        ['/', {}], ['/source/UAV_AIRPORT', { Accept: '*/*', Upgrade: 'websocket' }],
        ['/control-room/uav/source-123', { 'X-Oneflight-Request-Kind': 'continue' }],
        ['/control-room/uav/source.json', {}], ['/source/UAV_AIRPORT/anything.js', {}],
        ['/assets/native.js', { 'Sec-Fetch-Dest': 'document' }],
        ['/unknown/document', { Accept: 'text/html' }],
      ]) {
        const response = await request(path, { Cookie: 'ONEFLIGHT_ENTRY=expired', ...headers });
        assert.equal(response.status, 403, path); assert.match(response.body, /飞控入口未放行/);
      }
    });
    await t.test('source never receives platform entry credentials or arbitrary cookies', async () => {
      const response = await request('/proxyApi/device/status', {
        Cookie: 'ONEFLIGHT_ENTRY=active; ONEFLIGHTSESSION=fake-parent; JSESSIONID=fake-java; locale=zh-cn; access_token=fake-native; username=operator',
        'X-Oneflight-Entry-Grant': 'forged', 'X-Oneflight-Request-Kind': 'entry', 'X-Oneflight-Gateway-Secret': 'forged',
      });
      assert.equal(response.status, 200);
      assert.deepEqual(JSON.parse(response.body), { cookie: 'access_token=fake-native; username=operator', grant: '', secret: '', kind: '' });
      assert.doesNotMatch(response.headers, /Set-Cookie:/i);
    });
    await t.test('BFF sets and clears only its entry cookie, internal check is not public, errors fail closed', async () => {
      const bootstrap = await request('/__oneflight/bootstrap?ticket=synthetic');
      assert.equal(bootstrap.status, 200); assert.match(bootstrap.headers, /Set-Cookie: ONEFLIGHT_ENTRY=active; HttpOnly;/i);
      const logout = await request('/__oneflight/logout', { Cookie: 'ONEFLIGHT_ENTRY=active', 'X-Oneflight-Entry-Grant': 'forged' });
      assert.equal(logout.body, 'active'); assert.match(logout.headers, /Max-Age=0/);
      assert.equal((await request('/__oneflight/gateway-check')).status, 404);
      assert.equal((await request('/__oneflight/entry-denied-401')).status, 404);
      assert.equal((await request('/proxyApi/status', { Cookie: 'ONEFLIGHT_ENTRY=unavailable' })).status, 500);
      const blocked = await request('/proxyWsApi/status', { Cookie: 'ONEFLIGHT_ENTRY=blocked' });
      assert.equal(blocked.status, 403); assert.equal(blocked.body, '');
    });
  } finally {
    if (started) await execute('docker', ['rm', '-f', name]).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});

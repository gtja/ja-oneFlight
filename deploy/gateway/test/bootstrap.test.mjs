import test from 'node:test';
import assert from 'node:assert/strict';
import { establishIdentity } from '../src/bootstrap-flow.js';

test('account switch clears old token before writing new identity and navigation', async () => {
  const calls = [];
  const config = { mode: 'bootstrap', token: 'new-user-token', targetPath: '/control-room/uav/source-123' };
  await establishIdentity(config, {
    clear: async () => calls.push('clear'),
    store: async (key, value) => calls.push([key, value]),
    navigate: (path) => calls.push(path),
  });
  assert.deepEqual(calls, ['clear', ['token', 'new-user-token'], '/control-room/uav/source-123']);
  assert.equal(config.token, '');
});

test('native airport entry stores identity only in the child and navigates without a token URL', async () => {
  const calls = [];
  const config = { mode: 'bootstrap', token: 'native-user-token', targetPath: '/source/UAV_AIRPORT' };
  await establishIdentity(config, {
    clear: async () => calls.push('clear'),
    store: async (key, value) => calls.push([key, value]),
    navigate: (path) => {
      assert.equal(path, '/source/UAV_AIRPORT');
      assert.equal(path.includes('token'), false);
      calls.push(path);
    },
  });
  assert.deepEqual(calls, ['clear', ['token', 'native-user-token'], '/source/UAV_AIRPORT']);
  assert.equal(config.token, '');
});
for (const failure of ['clear', 'write']) test(`${failure} failure never navigates using the previous identity`, async () => {
  let navigated = false;
  await assert.rejects(establishIdentity({ mode: 'bootstrap', token: 'B', targetPath: '/control-room' }, {
    clear: async () => { if (failure === 'clear') throw new Error('unavailable'); },
    store: async () => { throw new Error('write denied'); },
    navigate: () => { navigated = true; },
  }));
  assert.equal(navigated, false);
});
for (const targetPath of ['https://evil.example/control-room', '//evil.example', '/assets/a.js', '/control-room?token=secret', '/control-room/uav/../../admin', '/control-room/uav/..', '/control-room/uav/%2Fadmin', '/control-room/uav/%2e%2e', '/source/UAV_AIRPORT?token=secret', '/source/UAV_AIRPORT#token', '/source/UAV_AIRPORT/nested', '/source/UAV_AIRPORT/', '/source/https://evil.example', '/source/UAV_AIRPORT?next=https://evil.example']) {
  test(`rejects arbitrary target ${targetPath}`, async () => {
    let writes = 0;
    await assert.rejects(establishIdentity({ mode: 'bootstrap', token: 'B', targetPath }, {
      clear: async () => writes++, store: async () => writes++, navigate: () => writes++,
    }));
    assert.equal(writes, 0);
  });
}

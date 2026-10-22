export async function establishIdentity(config, { clear, store, navigate }) {
  if (config.mode !== 'bootstrap' || typeof config.token !== 'string' || !config.token) {
    throw new Error('invalid bootstrap');
  }
  if (config.targetPath !== '/source/UAV_AIRPORT' && !/^\/control-room(?:\/uav\/[A-Za-z0-9_%.-]+)?$/.test(config.targetPath || '')) {
    throw new Error('invalid target');
  }
  const segment = config.targetPath.split('/').at(-1);
  const decoded = decodeURIComponent(segment);
  if (decoded === '.' || decoded === '..' || /[\/\\\u0000-\u001f]/.test(decoded)) throw new Error('invalid source id');
  // Removing A must succeed before B is stored; failed writes never open source UI.
  await clear();
  await store('token', config.token);
  config.token = '';
  navigate(config.targetPath);
}

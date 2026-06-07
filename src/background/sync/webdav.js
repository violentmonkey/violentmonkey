import { tryUrl } from '@/common';
import {
  ANONYMOUS,
  PASSWORD,
  SERVER_URL,
  USER_CONFIG,
  USERNAME,
} from '@/common/consts-sync';
import { createSyncService, register } from './sync-engine';

const DEFAULT_CONFIG = {
  [SERVER_URL]: '',
  [ANONYMOUS]: false,
  [USERNAME]: '',
  [PASSWORD]: '',
};

register(createSyncService({
  name: 'webdav',
  displayName: 'WebDAV',
  driveProvider: 'webdav',
  authProvider: 'password',
  properties: {
    authType: PASSWORD,
    [SERVER_URL]: null,
  },
  metaError(res) {
    if (![404, 409].includes(res.status)) throw res;
  },
  getUserConfig() {
    return (this[USER_CONFIG] ||= {
      ...DEFAULT_CONFIG,
      ...this.config.get(USER_CONFIG),
    });
  },
  setUserConfig(cfg) {
    Object.assign(this[USER_CONFIG], cfg);
    this.config.set(USER_CONFIG, this[USER_CONFIG]);
  },
  mapPasswordAuth(uc) {
    let url = uc[SERVER_URL]?.trim() || '';
    if (!url.includes('://')) url = `http://${url}`;
    if (!url.endsWith('/')) url += '/';
    if (!tryUrl(url)) return null;
    const serverUrl = `${url}${VIOLENTMONKEY}/`;
    const { anonymous, username, password } = uc;
    return {
      user: username || '',
      password: password || '',
      serverOptions: { baseUrl: serverUrl, anonymous },
    };
  },
}));

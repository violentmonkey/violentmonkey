import { tryUrl } from '@/common';
import {
  ANONYMOUS,
  PASSWORD,
  SERVER_URL,
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
  defaultUserConfig: DEFAULT_CONFIG,
  properties: {
    authType: PASSWORD,
    [SERVER_URL]: null,
  },
  metaError(res) {
    if (
      ![
        404, // File not exists
        409, // Directory not exists
      ].includes(res.status)
    )
      throw res;
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

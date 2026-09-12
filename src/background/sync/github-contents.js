import {
  API_BASE,
  BRANCH,
  CREATE_METHOD,
  GIT_AUTH,
  OWNER,
  PASSWORD,
  PATH_PREFIX,
  REPO,
} from '@/common/consts-sync';
import { createSyncService, register } from './sync-engine';

// Covers any host implementing GitHub's "contents API": GitHub.com, GHES,
// Gitea, and Forgejo. Host independence comes from the user-configurable API
// base URL — see @usync/drive's github-contents provider. createMethod
// exists because Gitea/Forgejo require POST (not PUT) to create a file.
const DEFAULT_CONFIG = {
  [API_BASE]: 'https://api.github.com',
  [OWNER]: '',
  [REPO]: '',
  [BRANCH]: 'main',
  [PATH_PREFIX]: '',
  [CREATE_METHOD]: 'put',
  [PASSWORD]: '',
};

register(
  createSyncService({
    name: 'github-contents',
    displayName: 'GitHub / Gitea',
    driveProvider: 'github-contents',
    authProvider: 'password',
    defaultUserConfig: DEFAULT_CONFIG,
    properties: {
      authType: GIT_AUTH,
    },
    mapPasswordAuth(uc) {
      const owner = uc[OWNER]?.trim();
      const repo = uc[REPO]?.trim();
      const token = uc[PASSWORD]?.trim();
      if (!owner || !repo || !token) return null;
      let apiBase = uc[API_BASE]?.trim() || 'https://api.github.com';
      apiBase = apiBase.replace(/\/+$/, '');
      return {
        user: '',
        password: token,
        serverOptions: {
          apiBase,
          owner,
          repo,
          branch: uc[BRANCH]?.trim() || 'main',
          pathPrefix: uc[PATH_PREFIX]?.trim() || '',
          createMethod: uc[CREATE_METHOD] === 'post' ? 'post' : 'put',
        },
      };
    },
  }),
);

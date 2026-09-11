import {
  API_BASE,
  BRANCH,
  GIT_AUTH,
  OWNER,
  PASSWORD,
  PATH_PREFIX,
  REPO,
} from '@/common/consts-sync';
import { createSyncService, register } from './sync-engine';

// Covers any host that speaks the same "Contents API" GitHub does:
// GitHub.com, GitHub Enterprise Server, Gitea, and Forgejo (the latter two
// deliberately mirror GitHub's REST shape). Host independence comes from the
// user-configurable API base URL rather than any per-host code here — see
// @usync/drive's gitcontents provider.
const DEFAULT_CONFIG = {
  [API_BASE]: 'https://api.github.com',
  [OWNER]: '',
  [REPO]: '',
  [BRANCH]: 'main',
  [PATH_PREFIX]: '',
  [PASSWORD]: '',
};

register(
  createSyncService({
    name: 'gitcontents',
    displayName: 'GitHub / Gitea',
    driveProvider: 'gitcontents',
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
        },
      };
    },
  }),
);

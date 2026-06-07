import { VM_HOME } from '@/common/consts';
import { createSyncService, register } from './sync-engine';

// Note:
// - SPA refresh tokens expire after 24h, but each refresh operation returns a new refresh_token, extending the expiration.
// - Browser extensions cannot use the native app authorization flow due to Microsoft's restrictions.

const config = {
  client_id: process.env.SYNC_ONEDRIVE_CLIENT_ID,
  redirect_uri: VM_HOME + 'auth_onedrive.html',
  scope: 'openid profile Files.ReadWrite.AppFolder offline_access',
  provider: {
    microsoft: {
      accountType: process.env.SYNC_ONEDRIVE_ACCOUNT_TYPE || 'consumers',
    },
  },
};

if (config.client_id) {
  register(
    createSyncService({
      name: 'onedrive',
      displayName: 'OneDrive',
      driveProvider: 'onedrive',
      authProvider: 'microsoft',
      config,
    }),
  );
}

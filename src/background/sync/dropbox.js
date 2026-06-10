import { VM_HOME } from '@/common/consts';
import { createSyncService, register } from './sync-engine';

const config = {
  client_id: process.env.SYNC_DROPBOX_CLIENT_ID,
  redirect_uri: VM_HOME + 'auth_dropbox.html',
};

if (config.client_id) {
  register(
    createSyncService({
      name: 'dropbox',
      displayName: 'Dropbox',
      driveProvider: 'dropbox',
      authProvider: 'dropbox',
      config,
    }),
  );
}

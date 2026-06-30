import { createSyncService, register } from './sync-engine';

// Note:
// - Use a native app approach for longer authorization periods,
// - Web app refresh tokens have short expiration and require frequent user reauthorization.

const config = {
  client_id: process.env.SYNC_GOOGLE_DESKTOP_ID,
  client_secret: process.env.SYNC_GOOGLE_DESKTOP_SECRET,
  // Google OAuth for native app only allows loopback IP address for callback URL.
  // The URL will be intercepted and blocked so the port doesn't matter.
  redirect_uri: 'http://127.0.0.1:45678/',
  scope: 'https://www.googleapis.com/auth/drive.appdata',
  provider: {
    google: {
      accessType: 'offline',
      prompt: 'consent',
    },
  },
};

if (config.client_id && config.client_secret) {
  register(
    createSyncService({
      name: 'googledrive',
      displayName: 'Google Drive',
      driveProvider: 'googledrive',
      authProvider: 'google',
      config,
    }),
  );
}

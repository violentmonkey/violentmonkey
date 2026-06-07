import {
  ACCESS_KEY_ID,
  BUCKET,
  REGION,
  S3_AUTH,
  S3_ENDPOINT,
  S3_PREFIX,
  SECRET_ACCESS_KEY,
  USER_CONFIG,
} from '@/common/consts-sync';
import { createSyncService, register } from './sync-engine';

const DEFAULT_CONFIG = {
  [BUCKET]: '',
  [REGION]: '',
  [S3_ENDPOINT]: '',
  [ACCESS_KEY_ID]: '',
  [SECRET_ACCESS_KEY]: '',
  [S3_PREFIX]: '',
};

register(createSyncService({
  name: 's3',
  displayName: 'S3 Compatible',
  driveProvider: 's3',
  authProvider: 'password',
  properties: {
    authType: S3_AUTH,
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
    const bucket = uc[BUCKET]?.trim();
    const region = uc[REGION]?.trim() || 'us-east-1';
    let endpoint = uc[S3_ENDPOINT]?.trim();
    const accessKeyId = uc[ACCESS_KEY_ID]?.trim();
    const secretAccessKey = uc[SECRET_ACCESS_KEY]?.trim();
    if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) return null;
    if (!endpoint.includes('://')) endpoint = `https://${endpoint}`;
    return {
      user: accessKeyId,
      password: secretAccessKey,
      serverOptions: {
        bucket,
        endpoint: endpoint.replace(/\/$/, ''),
        prefix: uc[S3_PREFIX]?.trim() ?? '',
        region,
      },
    };
  },
}));

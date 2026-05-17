// References:
// - https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
// - https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html
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
import {
  BaseService,
  getItemFilename,
  getURI,
  isScriptFile,
  register,
} from './base';

const DEFAULT_CONFIG = {
  [BUCKET]: '',
  [REGION]: '',
  [S3_ENDPOINT]: '',
  [ACCESS_KEY_ID]: '',
  [SECRET_ACCESS_KEY]: '',
  [S3_PREFIX]: '',
};

const encode = new TextEncoder();

// Per Sig V4: only unreserved chars (RFC 3986) are left unencoded in path segments.
function encodeSegment(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

function toHex(buf) {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256hex(data) {
  const buf = typeof data === 'string' ? encode.encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return toHex(new Uint8Array(hash));
}

async function hmacSha256(key, data) {
  const keyBuf = typeof key === 'string' ? encode.encode(key) : key;
  const k = await crypto.subtle.importKey(
    'raw', keyBuf, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, encode.encode(data)));
}

async function getSigningKey(secret, datestamp, region) {
  let key = await hmacSha256(`AWS4${secret}`, datestamp);
  key = await hmacSha256(key, region);
  key = await hmacSha256(key, 's3');
  return hmacSha256(key, 'aws4_request');
}

async function signS3Request({
  method,
  endpoint,
  pathSegments,
  queryParams = {},
  body = null,
  accessKeyId,
  secretKey,
  region,
}) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const datestamp = amzDate.slice(0, 8);

  const canonicalUri = '/' + pathSegments.map(encodeSegment).join('/');
  const sortedParams = Object.entries(queryParams)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const canonicalQS = sortedParams
    .map(([k, v]) => `${encodeSegment(k)}=${encodeSegment(v)}`)
    .join('&');
  const url = `${endpoint}${canonicalUri}${canonicalQS ? `?${canonicalQS}` : ''}`;
  const host = new URL(url).host;

  const EMPTY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const payloadHash = body != null ? await sha256hex(body) : EMPTY_HASH;

  const reqHeaders = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const sortedNames = Object.keys(reqHeaders).sort();
  const canonicalHeaders = sortedNames.map(k => `${k}:${reqHeaders[k]}\n`).join('');
  const signedHeaders = sortedNames.join(';');

  const canonicalRequest = [method, canonicalUri, canonicalQS, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${datestamp}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, await sha256hex(canonicalRequest)].join('\n');

  const signingKey = await getSigningKey(secretKey, datestamp, region);
  const signature = toHex(await hmacSha256(signingKey, stringToSign));

  reqHeaders['Authorization'] = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url, headers: reqHeaders };
}

function parseListXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const ns = 'http://s3.amazonaws.com/doc/2006-03-01/';

  // Some S3-compatible services omit the AWS namespace; fall back to no-namespace.
  function elsByTag(parent, tag) {
    const r = [...parent.getElementsByTagNameNS(ns, tag)];
    return r.length ? r : [...parent.getElementsByTagName(tag)];
  }
  function elByTag(parent, tag) {
    return parent.getElementsByTagNameNS(ns, tag)[0]
      || parent.getElementsByTagName(tag)[0];
  }

  const items = elsByTag(doc, 'Contents').map((el) => {
    const key = elByTag(el, 'Key')?.textContent || '';
    const name = key.split('/').pop();
    if (!isScriptFile(name)) return null;
    const size = +(elByTag(el, 'Size')?.textContent || 0);
    return normalize({ name, size });
  }).filter(Boolean);

  const nextToken = elByTag(doc, 'NextContinuationToken')?.textContent;
  return { items, nextToken };
}

const S3 = BaseService.extend({
  name: 's3',
  displayName: 'S3 Compatible',
  properties: {
    authType: S3_AUTH,
  },

  getUserConfig() {
    return (this[USER_CONFIG] ||= {
      ...DEFAULT_CONFIG,
      ...this.config.get(USER_CONFIG),
    });
  },
  setUserConfig(config) {
    Object.assign(this[USER_CONFIG], config);
    this.config.set(USER_CONFIG, this[USER_CONFIG]);
  },
  hasAuth() {
    const c = this.getUserConfig();
    return !!(c[BUCKET] && c[S3_ENDPOINT] && c[ACCESS_KEY_ID] && c[SECRET_ACCESS_KEY]);
  },
  initToken() {
    const c = this.getUserConfig();
    const bucket = c[BUCKET]?.trim();
    const region = c[REGION]?.trim() || 'us-east-1';
    let endpoint = c[S3_ENDPOINT]?.trim();
    const accessKeyId = c[ACCESS_KEY_ID]?.trim();
    const secretAccessKey = c[SECRET_ACCESS_KEY]?.trim();
    if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) return false;
    if (!endpoint.includes('://')) endpoint = `https://${endpoint}`;
    this._endpoint = endpoint.replace(/\/$/, '');
    this._bucket = bucket;
    this._region = region;
    this._accessKeyId = accessKeyId;
    this._secretAccessKey = secretAccessKey;
    this._prefix = c[S3_PREFIX]?.trim() ?? '';
    return true;
  },
  async requestAuth() {
    await this.list();
  },
  metaError(res) {
    if (res.status !== 404) throw res;
  },
  _prefixSegments() {
    return this._prefix.split('/').filter(Boolean);
  },
  async _s3(method, name, body = null) {
    const pathSegments = [this._bucket, ...this._prefixSegments(), name];
    const { url, headers } = await signS3Request({
      method,
      endpoint: this._endpoint,
      pathSegments,
      body,
      accessKeyId: this._accessKeyId,
      secretKey: this._secretAccessKey,
      region: this._region,
    });
    return this.loadData({ method, url, headers, body });
  },
  async list() {
    const listPrefix = this._prefix ? `${this._prefix}/` : '';
    const items = [];
    let continuationToken;
    do {
      const queryParams = { delimiter: '/', 'list-type': '2', prefix: listPrefix };
      if (continuationToken) queryParams['continuation-token'] = continuationToken;
      const { url, headers } = await signS3Request({
        method: 'GET',
        endpoint: this._endpoint,
        pathSegments: [this._bucket],
        queryParams,
        accessKeyId: this._accessKeyId,
        secretKey: this._secretAccessKey,
        region: this._region,
      });
      const xml = await this.loadData({ url, headers });
      const page = parseListXml(xml);
      items.push(...page.items);
      continuationToken = page.nextToken;
    } while (continuationToken);
    return items;
  },
  get(item) {
    const name = getItemFilename(item);
    return this._s3('GET', name);
  },
  put(item, data) {
    const name = getItemFilename(item);
    return this._s3('PUT', name, data);
  },
  remove(item) {
    const name = getItemFilename(item);
    return this._s3('DELETE', name);
  },
});

function normalize(item) {
  return {
    name: item.name,
    size: item.size,
    uri: getURI(item.name),
  };
}

register(S3);

import { readFile } from 'fs/promises';
import { setTimeout } from 'node:timers/promises';

const {
  EDGE_CLIENT_ID,
  EDGE_API_KEY,
  EDGE_PRODUCT_ID,
  EDGE_NOTES = '',
} = process.env;
const [distFile] = process.argv.slice(2);

if (!EDGE_CLIENT_ID || !EDGE_API_KEY || !EDGE_PRODUCT_ID || !distFile) {
  throw new Error('EDGE_CLIENT_ID, EDGE_API_KEY, EDGE_PRODUCT_ID and distFile are required');
}

const endpoint = 'https://api.addons.microsoftedge.microsoft.com';

async function poll(fn, maxRetry = 10) {
  for (let i = 0; i < maxRetry; i += 1) {
    await setTimeout(1000 + i * 2000);
    if (await fn(i)) return true;
  }
  return false;
}

class Publisher {
  constructor(productId, apiKey, clientId, notes) {
    this.productId = productId;
    this.apiKey = apiKey;
    this.clientId = clientId;
    this.notes = notes;
  }

  async request(path, opts) {
    const url = `${endpoint}${path}`;
    let res;
    try {
      res = await fetch(url, {
        ...opts,
        headers: {
          ...opts?.headers,
          Authorization: `ApiKey ${this.apiKey}`,
          'X-ClientID': this.clientId,
        },
      });
    } catch (err) {
      throw new Error(
        `Network error: ${err instanceof Error ? err.message : err}`,
      );
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${text} (${url})`);
    }
    return res;
  }

  async upload(zipFile) {
    let body;
    if (typeof zipFile === 'string') body = await readFile(zipFile);
    else body = zipFile;
    const res = await this.request(
      `/v1/products/${this.productId}/submissions/draft/package`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/zip',
        },
        body,
      },
    );
    if (res.status !== 202) {
      throw new Error(`Expected 202, got ${res.status}`);
    }
    const operationId = res.headers.get('location');
    if (!operationId) {
      throw new Error('Missing operation ID in response headers');
    }
    return operationId;
  }

  async checkUpload(operationId) {
    const res = await this.request(
      `/v1/products/${this.productId}/submissions/draft/package/operations/${operationId}`,
    );
    const data = await res.json();
    if (data.status === 'InProgress') return false;
    if (data.status === 'Succeeded') return true;
    throw new Error(
      `Upload failed: ${data.message || data.errorCode || data.status}`,
    );
  }

  async uploadResult(zipFile) {
    const operationId = await this.upload(zipFile);
    if (
      !(await poll((i) => {
        console.log('Check upload:', operationId, i || '');
        return this.checkUpload(operationId);
      }))
    ) {
      throw new Error('Upload failed');
    }
  }

  async publish() {
    const res = await this.request(
      `/v1/products/${this.productId}/submissions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          notes: this.notes,
        }),
      },
    );
    if (res.status !== 202) {
      throw new Error(`Expected 202, got ${res.status}`);
    }
    const operationId = res.headers.get('location');
    if (!operationId) {
      throw new Error('Missing operation ID in response headers');
    }
    return operationId;
  }

  async checkPublish(operationId) {
    const res = await this.request(
      `/v1/products/${this.productId}/submissions/operations/${operationId}`,
    );
    const data = await res.json();
    if (data.status === 'InProgress') return false;
    if (data.status === 'Succeeded') return true;
    throw new Error(
      `Publish failed: ${data.message || data.errorCode || data.status}`,
    );
  }

  async publishResult() {
    const operationId = await this.publish();
    if (
      !(await poll((i) => {
        console.log('Check publish:', operationId, i || '');
        return this.checkPublish(operationId);
      }))
    ) {
      throw new Error('Publish failed');
    }
  }
}

async function main() {
  const publisher = new Publisher(EDGE_PRODUCT_ID, EDGE_API_KEY, EDGE_CLIENT_ID, EDGE_NOTES);
  await publisher.uploadResult(distFile);
  await publisher.publishResult();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

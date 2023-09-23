import { readFile, writeFile, mkdir } from 'fs/promises';
import spawn from 'cross-spawn';
import yaml from 'js-yaml';

const PROJECT_ID = 'o:violentmonkey:p:violentmonkey-nex';
const RESOURCE_ID = `${PROJECT_ID}:r:messagesjson`;
const RESOURCE_FILE = 'src/_locales/en/messages.yml';
const request = limitConcurrency(doRequest, 5);

function delay(time) {
  return new Promise(resolve => setTimeout(resolve, time));
}

function defer() {
  const deferred = {};
  deferred.promise = new Promise((resolve, reject) => {
    deferred.resolve = resolve;
    deferred.reject = reject;
  });
  return deferred;
}

function memoize(fn) {
  const cache = {};
  function wrapped(...args) {
    const key = args.toString();
    let result = cache[key];
    if (!result) {
      result = { data: fn(...args) };
      cache[key] = result;
    }
    return result.data;
  }
  return wrapped;
}

function limitConcurrency(fn, concurrency) {
  const tokens = [];
  const processing = new Set();
  async function getToken() {
    const token = defer();
    tokens.push(token);
    check();
    await token.promise;
    return token;
  }
  function releaseToken(token) {
    processing.delete(token);
    check();
  }
  function check() {
    while (tokens.length && processing.size < concurrency) {
      const token = tokens.shift();
      processing.add(token);
      token.resolve();
    }
  }
  async function limited(...args) {
    const token = await getToken();
    try {
      return await fn(...args);
    } finally {
      releaseToken(token);
    }
  }
  return limited;
}

async function doRequest(path, options) {
  options = {
    method: 'GET',
    ...options,
  };
  const init = {
    method: options.method,
    headers: {
      accept: 'application/vnd.api+json',
      ...options.headers,
      authorization: `Bearer ${process.env.TRANSIFEX_TOKEN}`,
    },
  };
  const qs = options.query ? `?${new URLSearchParams(options.query)}` : '';
  if (options.body) {
    init.headers['content-type'] ||= 'application/vnd.api+json';
    init.body = JSON.stringify(options.body);
  }
  if (!path.includes('://')) path = `https://rest.api.transifex.com${path}`;
  const resp = await fetch(path + qs, init);
  const isJson = /[+/]json$/.test(resp.headers.get('content-type').split(';')[0]);
  const result = await resp[isJson ? 'json' : 'text']();
  if (!resp.ok) throw { resp, result };
  return { resp, result };
}

async function uploadResource() {
  const source = yaml.load(await readFile(RESOURCE_FILE, 'utf8'));
  const content = Object.entries(source).reduce((prev, [key, value]) => {
    if (value.touched !== false) {
      prev[key] = {
        description: value.description,
        message: value.message,
      };
    }
    return prev;
  }, {});
  let { result } = await request('/resource_strings_async_uploads', {
    method: 'POST',
    body: {
      data: {
        type: 'resource_strings_async_uploads',
        attributes: {
          content: JSON.stringify(content),
          content_encoding: 'text',
        },
        relationships: {
          resource: {
            data: {
              id: RESOURCE_ID,
              type: 'resources',
            },
          },
        },
      },
    },
  });
  while (['pending', 'processing'].includes(result.data.attributes.status)) {
    await delay(500);
    ({ result } = await request(`/resource_strings_async_uploads/${result.data.id}`));
  }
  if (result.data.attributes.status !== 'succeeded') throw { result };
  return result.data.attributes.details;
}

async function getLanguages() {
  const { result } = await request(`/projects/${PROJECT_ID}/languages`);
  return result.data.map(({ attributes: { code } }) => code);
}

async function loadRemote(lang) {
  let { resp, result } = await request('/resource_translations_async_downloads', {
    method: 'POST',
    body: {
      data: {
        type: 'resource_translations_async_downloads',
        attributes: {
          mode: 'onlytranslated',
        },
        relationships: {
          language: {
            data: {
              id: `l:${lang}`,
              type: 'languages',
            },
          },
          resource: {
            data: {
              id: RESOURCE_ID,
              type: 'resources',
            },
          },
        },
      },
    },
  });
  while (!resp.redirected && ['pending', 'processing', 'succeeded'].includes(result.data.attributes.status)) {
    await delay(500);
    ({ resp, result } = await request(`/resource_translations_async_downloads/${result.data.id}`));
  }
  if (!resp.redirected) throw { resp, result };
  return result;
}

async function getTranslations(lang) {
  let { result } = await request('/resource_translations', {
    query: {
      'filter[resource]': RESOURCE_ID,
      'filter[language]': `l:${lang}`,
      include: 'resource_string',
    },
  });
  let { data, included } = result;
  while (result.links.next) {
    ({ result } = await request(result.links.next));
    data = data.concat(result.data);
    included = included.concat(result.included);
  }
  const includedMap = included.reduce((prev, item) => {
    prev[item.id] = item;
    return prev;
  }, {});
  data.forEach(item => {
    Object.assign(item.relationships.resource_string.data, includedMap[item.relationships.resource_string.data.id]);
  });
  return data;
}

async function updateTranslations(updates) {
  const { result } = await request('/resource_translations', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/vnd.api+json;profile="bulk"',
    },
    body: {
      data: updates,
    },
  });
  return result.data;
}

const loadData = memoize(async function loadData(lang) {
  const remote = await loadRemote(lang);
  const filePath = `src/_locales/${lang}/messages.yml`;
  const local = yaml.load(await readFile(filePath, 'utf8'));
  return { local, remote, filePath };
});

async function loadUpdatedLocales() {
  const diffUrl = process.env.DIFF_URL;
  if (!diffUrl) return;
  const res = await fetch(diffUrl);
  const result = await res.text();
  // Example:
  // diff --git a/src/_locales/ko/messages.yml b/src/_locales/ko/messages.yml
  const langs = result.split('\n')
    .map(line => {
      const matches = line.match(/^diff --git a\/src\/_locales\/([^/]+)\/messages.yml b\/src\/_locales\/([^/]+)\/messages.yml$/);
      const [, code1, code2] = matches || [];
      return code1 === code2 && code1;
    })
    .filter(Boolean);
  return langs;
}

async function pushTranslations(lang) {
  const { local, remote } = await loadData(lang);
  const remoteUpdate = {};
  Object.entries(local)
  .forEach(([key, value]) => {
    const remoteMessage = remote[key] && remote[key].message;
    if (value.touched !== false && value.message && value.message !== remoteMessage) remoteUpdate[key] = value;
  });
  if (Object.keys(remoteUpdate).length) {
    const strings = await getTranslations(lang);
    const updates = strings.filter(item => !item.attributes.reviewed && remoteUpdate[item.relationships.resource_string.data.attributes.key])
    .map(item => ({
      id: item.id,
      type: item.type,
      attributes: {
        strings: {
          other: remoteUpdate[item.relationships.resource_string.data.attributes.key].message,
        },
      },
    }));
    process.stdout.write(`\n  Uploading translations for ${lang}:\n  ${JSON.stringify(updates)}\n`);
    await updateTranslations(updates);
    process.stdout.write('  finished\n');
  } else {
    process.stdout.write('up to date\n');
  }
}

async function pullTranslations(lang) {
  const { local, remote, filePath } = await loadData(lang);
  Object.entries(local)
  .forEach(([key, value]) => {
    const remoteMessage = remote[key] && remote[key].message;
    if (remoteMessage) value.message = remoteMessage;
  });
  await writeFile(filePath, yaml.dump(local), 'utf8');
}

async function batchHandle(handle, allowedLangs) {
  process.stdout.write('Loading languages...');
  let langs = await getLanguages();
  process.stdout.write('OK\n');
  process.stdout.write(`Got ${langs.length} language codes\n`);
  for (const lang of langs) {
    await mkdir(`src/_locales/${lang}`, { recursive: true });
  }
  spawn.sync('yarn', ['i18n'], { stdio: 'inherit' });
  if (allowedLangs) langs = langs.filter(lang => allowedLangs.includes(lang));
  let finished = 0;
  const showProgress = () => {
    process.stdout.write(`\rHandling translations (${finished}/${langs.length})...`);
  };
  showProgress();
  await Promise.all(langs.map(async lang => {
    try {
      await handle(lang);
      finished += 1;
      showProgress();
    } catch (err) {
      process.stderr.write(`\nError handling ${lang}\n`);
      throw err;
    }
  }));
  process.stdout.write('\n');
}

async function updateResource() {
  const result = await uploadResource();
  console.log(Object.entries(result).map(([key, value]) => `${key}: ${value}`).join(', '));
}

async function main() {
  const [,, command] = process.argv;
  switch (command) {
    case 'update': {
      return updateResource();
    }
    case 'push': {
      // Limit to languages changed in this PR only
      const allowedLangs = await loadUpdatedLocales();
      return batchHandle(pushTranslations, allowedLangs);
    }
    case 'pull': {
      return batchHandle(pullTranslations);
    }
    default: {
      throw new Error(`Unknown command: ${command}`);
    }
  }
}

main().catch(err => {
  console.error(err);
  if (err?.result) console.error('Response:', JSON.stringify(err.result, null, 2));
  process.exitCode = 1;
});

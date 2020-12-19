const fs = require('fs').promises;
const spawn = require('cross-spawn');
const yaml = require('js-yaml');

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

function exec(cmd, args, options) {
  return new Promise((resolve, reject) => {
    const { stdin, ...rest } = options || {};
    const child = spawn(
      cmd,
      args,
      { ...rest, stdio: ['pipe', 'pipe', 'inherit'] },
    );
    if (stdin != null) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
    const stdoutBuffer = [];
    child.stdout.on('data', chunk => {
      stdoutBuffer.push(chunk);
    })
    child.on('exit', (code) => {
      if (code) {
        reject(code);
        return;
      }
      const result = Buffer.concat(stdoutBuffer).toString('utf8');
      resolve(result);
    });
  });
}

let lastRequest;
async function transifexRequest(url, {
  method = 'GET',
  responseType = 'json',
  data = null,
} = {}) {
  const deferred = defer();
  const prevRequest = lastRequest;
  lastRequest = deferred.promise;
  try {
    await prevRequest;
    let result = await exec(
      'curl',
      [
        '-sSL',
        '--user',
        `api:${process.env.TRANSIFEX_TOKEN}`,
        '-X',
        method,
        '-H',
        'Content-Type: application/json',
        ...data == null ? [] : ['-d', '@-'],
        `https://www.transifex.com${url}`,
      ],
      {
        stdin: data ? JSON.stringify(data) : null,
      },
    );
    if (responseType === 'json') {
      result = JSON.parse(result);
    }
    deferred.resolve(delay(500));
    return result;
  } catch (err) {
    deferred.reject(err);
    throw err;
  }
}

async function getLanguages() {
  const result = await transifexRequest('/api/2/project/violentmonkey-nex/?details');
  return result.teams;
}

async function loadRemote(lang) {
  // Reference: https://docs.transifex.com/api/translations#downloading-and-uploading-translations
  // Use translated messages since we don't have enough reviewers
  const result = await transifexRequest(`/api/2/project/violentmonkey-nex/resource/messagesjson/translation/${lang}/?mode=onlytranslated`);
  const remote = JSON.parse(result.content);
  return remote;
}

const loadData = memoize(async function loadData(lang) {
  const remote = await loadRemote(lang);
  const filePath = `src/_locales/${lang}/messages.yml`;
  const local = yaml.safeLoad(await fs.readFile(filePath, 'utf8'));
  return { local, remote, filePath };
});

const loadUpdatedLocales = memoize(async function loadUpdatedLocales() {
  const diffUrl = process.env.DIFF_URL;
  if (!diffUrl) return;
  const result = await exec('curl', ['-sSL', diffUrl]);
  // Example:
  // diff --git a/src/_locales/ko/messages.yml b/src/_locales/ko/messages.yml
  const codes = result.split('\n')
    .map(line => {
      const matches = line.match(/^diff --git a\/src\/_locales\/([^/]+)\/messages.yml b\/src\/_locales\/([^/]+)\/messages.yml$/);
      const [, code1, code2] = matches || [];
      return code1 === code2 && code1;
    })
    .filter(Boolean);
  return codes;
});

async function pushTranslations(lang) {
  const codes = await loadUpdatedLocales();
  // Limit to languages changed in this PR only
  if (codes && !codes.includes(lang)) return;
  const { local, remote } = await loadData(lang);
  const remoteUpdate = {};
  Object.entries(local)
  .forEach(([key, value]) => {
    const remoteMessage = remote[key] && remote[key].message;
    if (value.touched !== false && value.message && value.message !== remoteMessage) remoteUpdate[key] = value;
  });
  if (Object.keys(remoteUpdate).length) {
    const strings = await transifexRequest(`/api/2/project/violentmonkey-nex/resource/messagesjson/translation/${lang}/strings/`);
    const updates = strings.filter(({ key, reviewed }) => !reviewed && remoteUpdate[key])
      .map(({ key, string_hash }) => ({
        source_entity_hash: string_hash,
        translation: remoteUpdate[key].message,
      }));
    process.stdout.write(`\n  Uploading translations for ${lang}:\n  ${JSON.stringify(updates)}\n`);
    await transifexRequest(`/api/2/project/violentmonkey-nex/resource/messagesjson/translation/${lang}/strings/`, {
      method: 'PUT',
      responseType: 'text',
      data: updates,
    });
    process.stdout.write('  finished\n');
  } else {
    process.stdout.write('up to date\n');
  }
}

async function pullTranslations(code) {
  const { local, remote, filePath } = await loadData(code);
  Object.entries(local)
  .forEach(([key, value]) => {
    const remoteMessage = remote[key] && remote[key].message;
    if (remoteMessage) value.message = remoteMessage;
  });
  await fs.writeFile(filePath, yaml.safeDump(local), 'utf8');
}

async function main() {
  let handle;
  if (process.argv.includes('push')) handle = pushTranslations;
  else if (process.argv.includes('pull')) handle = pullTranslations;
  else process.exit(2);
  process.stdout.write('Loading languages...');
  const codes = await getLanguages();
  process.stdout.write('OK\n');
  process.stdout.write(`Got ${codes.length} language codes\n`);
  for (const code of codes) {
    await fs.mkdir(`src/_locales/${code}`, { recursive: true });
  }
  spawn.sync('yarn', ['i18n'], { stdio: 'inherit' });
  let current = 0;
  const showProgress = (lang) => {
    process.stdout.write(`\rLoading translations ${lang} (${current}/${codes.length})...`);
  };
  for (const code of codes) {
    current += 1;
    showProgress(code);
    try {
      await handle(code);
    } catch (err) {
      process.stderr.write(`\nError pulling ${code}\n`)
      throw err;
    }
  }
  showProgress('OK');
  process.stdout.write('\n');
}

main();

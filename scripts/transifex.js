const fs = require('fs').promises;
const spawn = require('cross-spawn');
const yaml = require('js-yaml');

function delay(time) {
  return new Promise(resolve => setTimeout(resolve, time));
}

function transifexRequest(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const child = spawn('curl', [
      '-sSL',
      '--user',
      `api:${process.env.TRANSIFEX_TOKEN}`,
      '-X',
      method,
      `https://www.transifex.com${url}`,
    ], { stdio: ['ignore', 'pipe', 'inherit'] });
    const stdoutBuffer = [];
    child.stdout.on('data', chunk => {
      stdoutBuffer.push(chunk);
    })
    child.on('exit', (code) => {
      if (code) {
        reject(code);
      } else {
        const stdout = Buffer.concat(stdoutBuffer).toString('utf8');
        try {
          resolve(JSON.parse(stdout));
        } catch (err) {
          console.error('stdout: ' + stdout);
          throw err;
        }
      }
    });
  });
}

async function getLanguages() {
  const result = await transifexRequest('/api/2/project/violentmonkey-nex/?details');
  return result.teams;
}

async function loadRemote(lang) {
  // Reference: https://docs.transifex.com/api/translations#downloading-and-uploading-translations
  // Use translated messages since we don't have enough reviewers
  const result = await transifexRequest(`/api/2/project/violentmonkey-nex/resource/messagesjson/translation/${lang}/?mode=onlytranslated`);
  const reviewed = JSON.parse(result.content);
  return reviewed;
}

async function extract(lang) {
  const reviewed = await loadRemote(lang);
  const fullPath = `src/_locales/${lang}/messages.yml`;
  const existed = yaml.safeLoad(await fs.readFile(fullPath, 'utf8'));
  Object.entries(existed)
  .forEach(([key, value]) => {
    const reviewedMessage = reviewed[key] && reviewed[key].message;
    if (reviewedMessage) value.message = reviewedMessage;
  });
  await fs.writeFile(fullPath, yaml.safeDump(existed), 'utf8');
}

async function main() {
  process.stdout.write('Loading languages...');
  const codes = await getLanguages();
  process.stdout.write('OK\n');
  process.stdout.write(`Got ${codes.length} language codes\n`);
  for (const code of codes) {
    await fs.mkdir(`src/_locales/${code}`, { recursive: true });
  }
  spawn.sync('yarn', ['i18n'], { stdio: 'inherit' });
  let finished = 0;
  const showProgress = () => {
    process.stdout.write(`\rLoading translations (${finished}/${codes.length})...`);
  };
  showProgress();
  for (const code of codes) {
    await delay(500);
    try {
      await extract(code);
    } catch (err) {
      process.stderr.write(`\nError pulling ${code}\n`)
    }
    finished += 1;
    showProgress();
  }
  process.stdout.write('OK\n');
}

main();

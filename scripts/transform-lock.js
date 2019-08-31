const fs = require('fs');
const util = require('util');

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

const base = {
  parse(url) {
    const parts = url.slice(this.prefix.length).split('/');
    let scope;
    if (parts[0].startsWith('@')) scope = parts.shift();
    const name = parts.shift();
    const suffix = parts.pop();
    return { scope, name, suffix };
  },
  build({ scope, name, suffix }) {
    return this.prefix + [scope, name, '-', suffix].filter(Boolean).join('/');
  },
};
const targets = {
  taobao: Object.assign({}, base, {
    prefix: 'https://registry.npm.taobao.org/',
    build({ scope, name, suffix }) {
      return this.prefix + [scope, name, 'download', scope, suffix].filter(Boolean).join('/');
    },
  }),
  yarn: Object.assign({}, base, {
    prefix: 'https://registry.yarnpkg.com/',
  }),
  npm: Object.assign({}, base, {
    prefix: 'https://registry.npmjs.org/',
  }),
};

function parseResolved(resolved) {
  let result;
  Object.entries(targets)
  .some(([key, value]) => {
    if (resolved.startsWith(value.prefix)) {
      result = value.parse(resolved);
      return true;
    }
  });
  if (!result) throw new Error(`Unknown resolved value: ${resolved}`);
  return result;
}

function getProcessor(targetName) {
  const target = targets[targetName];
  return line => {
    const matches = line.match(/(\s+resolved\s+)"(.*)"/);
    if (!matches) return line;
    const parsed = parseResolved(matches[2]);
    return `${matches[1]}"${target.build(parsed)}"`;
  };
}

async function transformLock(name) {
  const disallowChange = name.startsWith('=');
  const targetName = disallowChange ? name.slice(1) : name;
  const originalContent = await readFile('yarn.lock', 'utf8');
  const content = originalContent.split('\n')
  .map(getProcessor(targetName))
  .join('\n');
  if (originalContent !== content) {
    await writeFile('yarn.lock', content, 'utf8');
    console.error('yarn.lock is updated.');
    if (disallowChange) process.exit(2);
  }
}

transformLock(process.argv[2]);

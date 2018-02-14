const fs = require('fs');
const util = require('util');

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

// sed -i '' 's|https://registry.npm.taobao.org|https://registry.yarnpkg.com|g' yarn.lock

const targets = {
  taobao: 'http://registry.npm.taobao.org/',
  yarn: 'https://registry.yarnpkg.com/',
  npm: 'http://registry.npmjs.org/',
};

function string2re(str, flag) {
  return new RegExp(str.replace(/([./])/g, '\\$1'), flag);
}

async function transformLock(name) {
  const disallowChange = name.startsWith('=');
  const targetName = disallowChange ? name.slice(1) : name;
  const prefix = targets[targetName];
  if (!prefix) {
    console.error('Unknown target:', targetName);
    process.exit(1);
    return;
  }
  const transformers = Object.entries(targets)
  .filter(([key]) => key !== targetName)
  .map(([_, value]) => string2re(value, 'g'));
  const originalContent = await readFile('yarn.lock', 'utf8');
  let content = originalContent;
  transformers.forEach(transformer => {
    content = content.replace(transformer, prefix);
  });
  if (originalContent !== content) {
    await writeFile('yarn.lock', content, 'utf8');
    console.error('yarn.lock is updated.');
    if (disallowChange) process.exit(2);
  }
}

transformLock(process.argv[2]);

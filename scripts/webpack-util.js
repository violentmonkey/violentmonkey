const fs = require('fs');
const babelCore = require('@babel/core');
const WrapperWebpackPlugin = require('wrapper-webpack-plugin');

// {entryName: path}
const entryGlobals = {
  common: [
    './src/common/safe-globals.js',
  ],
  'injected/content': [
    './src/injected/safe-globals-injected.js',
    './src/injected/content/safe-globals-content.js',
  ],
  'injected/web': [
    './src/injected/safe-globals-injected.js',
    './src/injected/web/safe-globals-web.js',
  ],
};

/**
 * Adds a watcher for files in entryGlobals to properly recompile the project on changes.
 */
function addWrapperWithGlobals(name, config, defsObj, callback) {
  config.module.rules.push({
    test: new RegExp(`/${name}/.*?\\.js$`.replace(/\//g, /[/\\]/.source)),
    use: [{
      loader: './scripts/fake-dep-loader.js',
      options: { files: entryGlobals[name] },
    }],
  });
  const defsRe = new RegExp(`\\b(${
    Object.keys(defsObj)
    .join('|')
    .replace(/\./g, '\\.')
  })\\b`, 'g');
  const reader = () => (
    entryGlobals[name]
    .map(path => readGlobalsFile(path))
    .join('\n')
    .replace(defsRe, s => defsObj[s])
  );
  config.plugins.push(new WrapperWebpackPlugin(callback(reader)));
}

function getCodeMirrorThemes() {
  const name = 'neo.css';
  return fs.readdirSync(
    require.resolve(`codemirror/theme/${name}`).slice(0, -name.length),
    { withFileTypes: true },
  ).map(e => e.isFile() && e.name.endsWith('.css') && e.name.slice(0, -4))
  .filter(Boolean);
}

function getUniqIdB64() {
  return Buffer.from(
    new Uint32Array(2)
    .map(() => Math.random() * (2 ** 32))
    .buffer,
  ).toString('base64');
}

function readGlobalsFile(filename, babelOpts = {}) {
  const { ast, code = !ast } = babelOpts;
  const src = fs.readFileSync(filename, { encoding: 'utf8' })
  .replace(/\bexport\s+(function\s+(\w+))/g, 'const $2 = $1')
  .replace(/\bexport\s+(?=(const|let)\s)/g, '');
  const res = babelCore.transformSync(src, {
    ...babelOpts,
    ast,
    code,
    filename,
  });
  return ast ? res : res.code;
}

exports.addWrapperWithGlobals = addWrapperWithGlobals;
exports.getCodeMirrorThemes = getCodeMirrorThemes;
exports.getUniqIdB64 = getUniqIdB64;
exports.readGlobalsFile = readGlobalsFile;

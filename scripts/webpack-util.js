const fs = require('fs');
const babelCore = require('@babel/core');
const WrapperWebpackPlugin = require('wrapper-webpack-plugin');

const entryGlobals = {
  'common': [],
  'injected/content': [],
  'injected/web': [],
};
const entryPathToFilename = path => path === '*'
  ? `./src/common/safe-globals-shared.js`
  : `./src/${path}/safe-globals.js`;
Object.entries(entryGlobals).forEach(([name, val]) => {
  const parts = name.split('/');
  if (parts[1]) parts[1] = name;
  val.push('*', ...parts);
});

/**
 * Adds a watcher for files in entryGlobals to properly recompile the project on changes.
 */
function addWrapperWithGlobals(name, config, defsObj, callback) {
  config.module.rules.push({
    test: new RegExp(`/${name}/.*?\\.js$`.replace(/\//g, /[/\\]/.source)),
    use: [{
      loader: './scripts/fake-dep-loader.js',
      options: { files: entryGlobals[name].map(entryPathToFilename) },
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

function readGlobalsFile(path, babelOpts = {}) {
  const { ast, code = !ast } = babelOpts;
  const filename = entryPathToFilename(path);
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
exports.readGlobalsFile = readGlobalsFile;

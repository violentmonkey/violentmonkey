const fs = require('fs');
const path = require('path');
const glob = require('glob');
const ncp = require('ncp');

function promisify(func, ...partialArgs) {
  return function (...args) {
    return new Promise((resolve, reject) => {
      func(...args, ...partialArgs, (err, data) => {
        err ? reject(err) : resolve(data);
      });
    });
  };
}

const getFiles = (glob => {
  return function (pattern, cwd='.') {
    return glob(pattern, {nodir: true, cwd});
  };
})(promisify(glob));
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const copy = (copy => {
  return function (src, dest) {
    console.log(`Copy ${src} => ${dest}`);
    return copy(src, dest);
  };
})(promisify(ncp));

const MOD_DIR = 'node_modules';
const LIB_DIR = 'src/public/lib';
const mappings = {
  CodeMirror: 'codemirror',
  'define.js': 'define-commonjs',
};

function updateFile(dest, src) {
  const srcPath = path.join(MOD_DIR, src);
  return stat(srcPath)
  .then(res => res.isDirectory() ? path.join(srcPath, dest) : srcPath)
  .then(srcPath => copy(srcPath, path.join(LIB_DIR, dest)));
}

function updateDir(dest, src) {
  return getFiles('**', path.join(LIB_DIR, dest))
  .then(files => Promise.all(files.map(file => (
    copy(path.join(MOD_DIR, src, file), path.join(LIB_DIR, dest, file))
  ))));
}

function update(dest, src) {
  return stat(path.join(LIB_DIR, dest))
  .then(res => res.isFile() ? updateFile(dest, src) : updateDir(dest, src));
}

Promise.all(Object.keys(mappings).map(key => update(key, mappings[key])))
.catch(err => console.log(err));

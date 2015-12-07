'use strict';

const fs = require('fs');
const path = require('path');
const glob = require('glob');
const ncp = require('ncp');

const aliases = {
  CodeMirror: 'codemirror',
  'font-awesome': {},
};

function getFiles(pattern, cwd) {
  return new Promise((resolve, reject) => {
    glob(pattern, {nodir: true, cwd: cwd || '.'}, (err, files) => {
      err ? reject(err) : resolve(files);
    });
  });
}

function readdir(dir) {
  return new Promise((resolve, reject) => {
    fs.readdir(dir, (err, files) => {
      err ? reject(err) : resolve(files);
    });
  });
}

function copyFile(src, dest) {
  return new Promise((resolve, reject) => {
    ncp(src, dest, (err) => err ? reject(err) : resolve());
  }).then(() => {
    console.log(src + ' => ' + dest);
  });
}

function update(lib, files) {
  let alias = aliases[lib];
  if (typeof alias === 'string') alias = {
    lib: alias,
  };
  alias.lib = alias.lib || lib;
  const libdir = `node_modules/${alias.lib}`;
  const srcdir = `src/lib/${lib}`
  return Promise.all(files.map((file) => {
    let aliasFile = alias.files && alias.files[file] || file;
    if (aliasFile.endsWith('/')) aliasFile += file;
    const libfile = path.join(libdir, aliasFile);
    return copyFile(libfile, path.join(srcdir, file));
  })).catch(function (err) {
    console.log(err);
  });
}

readdir('./src/lib').then((data) => {
  data.forEach(function (name) {
    if (!aliases[name]) return;
    getFiles('**', `src/lib/${name}`).then((files) => {
      update(name, files);
    });
  });
});

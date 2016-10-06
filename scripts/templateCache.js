const path = require('path');
const gutil = require('gulp-util');
const through = require('through2');
const minify = require('html-minifier').minify;

function replacePlugin(contents, objName) {
  const re = new RegExp(`${objName}\\.get\\('(.*?)'\\)`, 'g');
  return through.obj(function (file, enc, cb) {
    const dirname = path.dirname(file.path);
    file.contents = new Buffer(String(file.contents).replace(re, (m, name) => {
      const filepath = path.resolve(dirname, name);
      const item = contents[filepath];
      if (!item) console.warn(`Cache not found: ${name}`);
      return `${objName}.get(${item.id})`;
    }));
    cb(null, file);
  });
}

module.exports = function templateCache(objName) {
  const contentTpl = `${objName}.put(<%= name %>, <%= content %>);\n`;
  const header = `\n\n/* Templates cached with love :) */\n`;
  const contents = {};

  function bufferContents(file, enc, cb) {
    if (file.isNull()) return cb();
    if (file.isStream()) return this.emit('error', new gutil.PluginError('VM-cache', 'Stream is not supported.'));
    contents[file.path] = {
      content: minify(String(file.contents), {
        removeComments: true,
        collapseWhitespace: true,
        conservativeCollapse: true,
        removeAttributeQuotes: true,
      }),
    };
    cb();
  }

  function endStream(cb) {
    var keys = Object.keys(contents).sort();
    keys.forEach((key, i) => contents[key].id = i + 1);
    this.replace = () => replacePlugin(contents, objName);
    const templates = keys.map(key => {
      const item = contents[key];
      return `${objName}.put(${item.id}, ${JSON.stringify(item.content)});`;
    }).join('\n');
    this.push(new gutil.File({
      base: '',
      path: 'template.js',
      contents: new Buffer(header + templates),
    }));
    cb();
  }

  return through.obj(bufferContents, endStream);
};

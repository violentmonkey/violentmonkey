'use strict';

const gutil = require('gulp-util');
const replace = require('gulp-replace');
const through = require('through2');
const minify = require('html-minifier').minify;

module.exports = function templateCache() {
  const contentTpl = 'cache.put(<%= name %>, <%= content %>);\n';
  const header = `/* Templates cached with love :) */
define('templates', function (require, exports, module) {
  var cache = require('cache');
`;
  const footer = `
});
`;
  const contents = [];

  function bufferContents(file, enc, cb) {
    if (file.isNull()) return cb();
    if (file.isStream())
      return this.emit('error', new gutil.PluginError('VM-cache', 'Stream is not supported.'));
    contents.push({
      filename: ('/' + file.relative).replace(/\\/g, '/'),
      content: minify(String(file.contents), {
        removeComments: true,
        collapseWhitespace: true,
        conservativeCollapse: true,
        removeAttributeQuotes: true,
      }),
    });
    cb();
  }

  function endStream(cb) {
    contents.sort((a, b) => {
      if (a.filename < b.filename) return -1;
      if (a.filename > b.filename) return 1;
      return 0;
    });
    const nameMap = contents.reduce((res, item, i) => {
      res[item.filename] = i;
      return res;
    }, {});
    this.replace = () => replace(/cache.get\('(.*?)'\)/g, (cache, filename) => {
      const key = nameMap[filename];
      if (key == null) console.warn(`Cache key not found: ${filename}`);
      return `cache.get(${key})`;
    });
    const templates = contents.map(item => {
      return `cache.put(${nameMap[item.filename]}, ${JSON.stringify(item.content)});`;
    }).join('\n');
    this.push(new gutil.File({
      base: '',
      path: 'template.js',
      contents: new Buffer(header + templates + footer),
    }));
    cb();
  }

  const cacheObj = through.obj(bufferContents, endStream);
  return cacheObj;
};

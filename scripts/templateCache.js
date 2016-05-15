'use strict';

const gutil = require('gulp-util');
const through = require('through2');
const _ = require('underscore');
const minified = require('./minifyHtml');

/*function minified(data) {
  data = String(data);
  return data.replace(/\s+/g, ' ');
}*/

module.exports = function templateCache() {
  const contentTpl = 'cache.put(<%= name %>, <%= content %>);\n';
  const header = `/* Templates cached from \`_.template\` with love :) */
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
    contents.push(gutil.template(contentTpl, {
      name: JSON.stringify(('/' + file.relative).replace(/\\/g, '/')),
      content: _.template(minified(file.contents), {variable: 'it'}).source,
      file: '',
    }));
    cb();
  }

  function endStream(cb) {
    this.push(new gutil.File({
      base: '',
      path: 'template.js',
      contents: new Buffer(header + contents.join('') + footer),
    }));
    cb();
  }

  return through.obj(bufferContents, endStream);
};

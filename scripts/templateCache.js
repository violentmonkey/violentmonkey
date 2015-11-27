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
  const contentTpl = '_.cache.put(<%= name %>, <%= content %>);\n';
  let content = '/* Below are templates cached from `_.template` with love :) */\n\n';

  function bufferContents(file, enc, cb) {
    if (file.isNull()) return cb();
    if (file.isStream())
      return this.emit('error', new gutil.PluginError('VM-cache', 'Stream is not supported.'));
    content += gutil.template(contentTpl, {
      name: JSON.stringify(('/' + file.relative).replace(/\\/g, '/')),
      content: _.template(minified(file.contents), {variable: 'it'}).source,
      file: '',
    });
    cb();
  }

  function endStream(cb) {
    this.push(new gutil.File({
      base: '',
      path: 'template.js',
      contents: new Buffer(content),
    }));
    cb();
  }

  return through.obj(bufferContents, endStream);
};

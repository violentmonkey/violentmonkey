const gutil = require('gulp-util');
const through = require('through2');

module.exports = function (options) {
  return through.obj(function (file, enc, cb) {
    if (file.isNull()) return cb();
    if (file.isStream()) return this.emit('error', new gutil.PluginError('VM-wrap', 'Stream is not supported.'));
    const header = options.header || '';
    const contents = String(file.contents);
    const footer = options.footer || '';
    file.contents = new Buffer(header + contents + footer);
    cb(null, file);
  });
};

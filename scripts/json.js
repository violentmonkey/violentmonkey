const gutil = require('gulp-util');
const through = require('through2');

module.exports = function (handle) {
  return through.obj(function (file, enc, cb) {
    if (file.isNull()) return cb();
    if (file.isStream()) return this.emit('error', new gutil.PluginError('VM-json', 'Stream is not supported.'));
    handle = handle || (i => i);
    file.contents = new Buffer(JSON.stringify(handle(JSON.parse(String(file.contents)))));
    cb(null, file);
  });
};

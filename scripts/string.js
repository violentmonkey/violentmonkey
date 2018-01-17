const PluginError = require('plugin-error');
const through = require('through2');

module.exports = function (handle) {
  return through.obj(function (file, enc, cb) {
    if (file.isNull()) return cb();
    if (file.isStream()) return this.emit('error', new PluginError('VM-json', 'Stream is not supported.'));
    if (handle) file.contents = new Buffer(handle(String(file.contents), file));
    cb(null, file);
  });
};

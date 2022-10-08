const Path = require('path');

module.exports = function FakeDepLoader(source, sourcemap) {
  this.query.files.forEach(f => this.addDependency(Path.resolve(f)));
  this.callback(null, source, sourcemap);
};

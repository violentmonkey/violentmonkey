const Path = require('path');

module.exports = function FakeDepLoader(source) {
  this.query.files.forEach(f => this.addDependency(Path.resolve(f)));
  return source;
};

const base = require('./webpack.base.conf');

module.exports = {
  ...base,
  target: 'node',
  entry: {
    test: './test',
  },
};

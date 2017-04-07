const webpack = require('webpack');
const base = require('./webpack.base.conf');

module.exports = Object.assign({}, base, {
  target: 'node',
  entry: {
    test: './test',
  },
});

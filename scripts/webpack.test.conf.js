const webpack = require('webpack');
const base = require('./webpack.base.conf');
const { merge } = require('./utils');

module.exports = merge(base, {
  target: 'node',
  entry: {
    test: './test',
  },
});

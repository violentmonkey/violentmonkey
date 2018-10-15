const SWPrecacheWebpackPlugin = require('sw-precache-webpack-plugin');
const { isProd } = require('../util');

module.exports = options => config => {
  config.plugins = [
    ...config.plugins || [],
    new SWPrecacheWebpackPlugin({
      minify: isProd,
      ...options,
    }),
  ].filter(Boolean);
};

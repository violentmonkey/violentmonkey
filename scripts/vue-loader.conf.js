const utils = require('./utils');
const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
  loaders: utils.cssLoaders({
    sourceMap: false,
    extract: isProduction,
  }),
  postcss: [ require('precss') ],
};

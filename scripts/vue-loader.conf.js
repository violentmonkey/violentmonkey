const { isProd } = require('./utils');

module.exports = {
  extractCSS: isProd,
  preserveWhitespace: false,
};

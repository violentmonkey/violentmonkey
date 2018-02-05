const { styleLoader } = require('./utils');

module.exports = {
  preserveWhitespace: false,
  loaders: {
    css: styleLoader({ fallback: 'vue-style-loader' }),
  },
};

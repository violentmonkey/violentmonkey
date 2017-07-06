const { styleLoader } = require('./utils');

module.exports = {
  loaders: {
    css: styleLoader({ fallback: 'vue-style-loader' }),
  },
};

const VueLoaderPlugin = require('vue-loader/lib/plugin');

module.exports = () => config => {
  config.resolve.extensions.push('.vue');
  config.module.rules.unshift({
    test: /\.vue$/,
    loader: 'vue-loader',
    options: {
      preserveWhitespace: false,
    },
  });
  config.plugins.push(new VueLoaderPlugin());
};

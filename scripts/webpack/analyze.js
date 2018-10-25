const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');

module.exports = () => config => {
  config.plugins = [
    ...config.plugins || [],
    new BundleAnalyzerPlugin(),
  ];
};

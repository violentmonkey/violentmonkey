const { resolve } = require('../util');

module.exports = () => config => {
  config.module = {
    ...config.module,
  };
  config.module.rules = [
    ...config.module.rules || [],
    {
      test: /\.(html|vert|frag)$/,
      use: 'raw-loader',
      include: [resolve('src')],
    },
  ];
};

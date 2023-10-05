const { alias } = require('./scripts/common');

module.exports = {
  parser: 'postcss-scss',
  plugins: [
    'postcss-simple-vars',
    // Transform @import, resolve `@` to `src`
    require('postcss-import')({
      resolve(id) {
        if (id.startsWith('~')) {
          const parts = id.slice(1).split('/');
          parts[0] = alias[parts[0]] || parts[0];
          return require.resolve(parts.join('/'));
        }
        return id;
      },
    }),
    // Calculate at compile time
    require('postcss-calc'),
    require('postcss-nested'),
    require('autoprefixer'),
  ],
};

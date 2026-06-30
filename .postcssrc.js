const { alias } = require('./scripts/common');
const { getBrowserTargets } = require('./scripts/manifest-helper');

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
    require('postcss-preset-env')({
      browsers: getBrowserTargets(),
      /** disabling the built-in postcss-nesting plugin because is uses :is() for correctness,
       * but it requires postcss-is-pseudo-class plugin which emits warnings about our css,
       * so we use a different postcss-nested plugin that seemingly works just fine. */
      'nesting-rules': false,
    }),
  ],
};

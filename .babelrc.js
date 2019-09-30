module.exports = {
  extends: require.resolve('@gera2ld/plaid/config/babelrc'),
  presets: [
    ['@babel/preset-env', {
      ...process.env.BABEL_ENV !== 'test' && {
        modules: false,
      },
      // Allow native implementation of these features (the list is incomplete)
      exclude: [
        // Chrome Firefox
        // 45 22
        'transform-arrow-functions',
        // 47 34
        'transform-computed-properties',
        // 49 41
        // 60 55 '...rest' in objects handled by transform-object-rest-spread
        'transform-destructuring',
        // 38 13
        'transform-for-of',
        // 55 52 - async/await
        'transform-regenerator',
        // 47 34
        'transform-shorthand-properties',
        // 49 44
        'transform-sticky-regex',
        // 41 34
        'transform-template-literals',
        // 50 46
        'transform-unicode-regex',
      ],
      useBuiltIns: false,
    }],
  ],
};

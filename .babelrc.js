module.exports = {
  extends: require.resolve('@gera2ld/plaid/config/babelrc'),
  presets: [
    ['@babel/preset-env', {
      ...process.env.BABEL_ENV !== 'test' && {
        modules: false,
      },
      exclude: [
        // for Firefox 52, see babel/babel#8204
        'transform-regenerator',
      ],
      useBuiltIns: false,
    }],
  ],
};

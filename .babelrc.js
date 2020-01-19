module.exports = {
  extends: require.resolve('@gera2ld/plaid/config/babelrc'),
  presets: [
    ['@babel/preset-env', {
      ...process.env.BABEL_ENV !== 'test' && {
        modules: false,
      },
      useBuiltIns: false,
      loose: true,
    }],
  ],
  plugins: [
    '@babel/plugin-proposal-function-bind',
  ],
};

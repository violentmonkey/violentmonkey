const TerserPlugin = require('terser-webpack-plugin');
const deepmerge = require('deepmerge');

const MIN = {
  extractComments: false,
  parallel: true,
  terserOptions: {
    compress: {
      // `terser` often inlines big one-time functions inside a small "hot" function
      reduce_funcs: false,
    },
    output: {
      ascii_only: true,
      comments: false,
      wrap_func_args: false, // disabling a premature optimization designed for old browsers
    },
  },
};
module.exports = [
  '...', // keep the built-in CSS/HTML minimizers
  new TerserPlugin({
    include: 'public/',
    ...MIN,
  }),
  new TerserPlugin(deepmerge.all([{}, MIN, {
    exclude: 'public/',
    terserOptions: {
      toplevel: true, // drop unused global vars and funcs
      compress: {
        ecma: 8, // ES2017 Object.entries and so on
        passes: 2, // necessary now since we removed plaid's minimizer
        unsafe_arrows: true, // it's 'safe' since we don't rely on function prototypes
      },
    },
  }])),
];

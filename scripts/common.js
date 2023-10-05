const path = require('path');

const isProd = process.env.NODE_ENV === 'production';

exports.isProd = isProd;
exports.alias = {
  '@': path.resolve('src'),
};
exports.extensions = [
  '.ts', '.tsx', '.mjs', '.js', '.jsx', '.vue',
];

const childProcess = require('child_process');
const path = require('path');

const isProd = process.env.NODE_ENV === 'production';

function exec(cmd) {
  try {
    return childProcess.execSync(cmd, { encoding: 'utf8' }).trim();
  } catch (e) {
    // ignore
  }
}

exports.isProd = isProd;
exports.alias = {
  '@': path.resolve('src'),
};
exports.extensions = [
  '.ts', '.tsx', '.mjs', '.js', '.jsx', '.vue',
];
exports.exec = exec;

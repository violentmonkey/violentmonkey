const childProcess = require('child_process');
const path = require('path');

const isProd = process.env.NODE_ENV === 'production';
const MV3 = process.env.MV3 === '1';
const DIST = MV3 ? 'dist-mv3' : 'dist';

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
exports.DIST = DIST;
exports.MV3 = MV3;

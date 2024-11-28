const fs = require('fs').promises;
const gulp = require('gulp');
const del = require('del');
const log = require('fancy-log');
const plumber = require('gulp-plumber');
const Sharp = require('sharp');
const spawn = require('cross-spawn');
const i18n = require('./scripts/i18n');
const { getVersion, isBeta } = require('./scripts/version-helper');
const { buildManifest } = require('./scripts/manifest-helper');
const pkg = require('./package.json');

const DIST = 'dist';
const paths = {
  manifest: 'src/manifest.yml',
  locales: [
    'src/_locales/**',
  ],
  templates: [
    'src/**/*.@(js|html|json|yml|vue)',
  ],
};

function clean() {
  return del(DIST);
}

function watch() {
  gulp.watch(paths.manifest, manifest);
  gulp.watch(paths.locales.concat(paths.templates), copyI18n);
}

async function jsDev() {
  return runCommand('webpack-cli', ['-w', '--config', 'scripts/webpack.conf.js']);
}

async function jsProd() {
  return runCommand('webpack-cli', ['--config', 'scripts/webpack.conf.js']);
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
    });
    child.on('close', (code, signal) => {
      (code ? reject : resolve)(signal);
    });
  });
}

/**
 * manifest is already handled in ListBackgroundScriptsPlugin
 *
 * This task is only used to tweak dist/manifest.json without rebuilding
 */
async function manifest() {
  const base = JSON.parse(await fs.readFile(`${DIST}/manifest.json`, 'utf8'));
  const data = await buildManifest(base);
  await fs.mkdir(DIST).catch(() => {});
  await fs.writeFile(`${DIST}/manifest.json`, JSON.stringify(data), 'utf8');
}

async function createIcons() {
  const ALPHA = 0.5;
  const dist = `${DIST}/public/images`;
  await fs.mkdir(dist, { recursive: true });
  const icon = Sharp(`src/resources/icon${isBeta() ? '-beta' : ''}.png`);
  const gray = icon.clone().grayscale();
  const transparent = icon.clone().composite([{
    input: Buffer.from([255, 255, 255, 256 * ALPHA]),
    raw: { width: 1, height: 1, channels: 4 },
    tile: true,
    blend: 'dest-in',
  }]);
  const types = [
    ['', icon],
    ['b', gray],
    ['w', transparent],
  ];
  const handle = (size, type = '', image = icon) => {
    let res = image.clone().resize({ width: size });
    if (size < 48) res = res.sharpen(size < 32 ? 0.5 : 0.25);
    return res.toFile(`${dist}/icon${size}${type}.png`);
  };
  const darkenOuterEdge = async img => img.composite([{
    input: await img.toBuffer(),
    blend: 'over',
  }]);
  const handle16 = async ([type, image]) => {
    const res = image.clone()
    .resize({ width: 18 })
    .sharpen(0.5, 0)
    .extract({ left: 1, top: 2, width: 16, height: 16 });
    return (type === 'w' ? res : await darkenOuterEdge(res))
    .toFile(`${dist}/icon16${type}.png`);
  };
  return Promise.all([
    handle(128),
    ...types.map(handle16),
    // 32px dashboard icon (recycled) + 2xDPI browser_action desktop
    // 38px dashboard icon (normal) + 1.5xDPI browser_action Android
    // 48px 2xDPI browser_action Android
    ...[32, 38, 48, 64].flatMap(size => types.map(t => handle(size, ...t))),
  ]);
}

/**
 * Bump `beta` in `package.json` to release a new beta version.
 */
async function bump() {
  if (process.argv.includes('--reset')) {
    delete pkg.beta;
  } else {
    pkg.beta = (+pkg.beta || 0) + 1;
  }
  await fs.writeFile('package.json', JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  if (process.argv.includes('--commit')) {
    const version = `v${getVersion()}`;
    spawn.sync('git', ['commit', '-am', version]);
    spawn.sync('git', ['tag', '-m', version, version]);
  }
}

function checkI18n() {
  return i18n.read({
    base: 'src/_locales',
    extension: '.json',
  });
}

function copyI18n() {
  return i18n.read({
    base: 'src/_locales',
    touchedOnly: true,
    useDefaultLang: true,
    markUntouched: false,
    extension: '.json',
    stripDescriptions: true,
  })
  .pipe(gulp.dest(`${DIST}/_locales`));
}

/**
 * Load locale files (src/_locales/<lang>/message.[json|yml]), and
 * update them with keys in template files, then store in `message.yml`.
 */
function updateI18n() {
  return gulp.src(paths.templates)
  .pipe(plumber(logError))
  .pipe(i18n.extract({
    base: 'src/_locales',
    manifest: 'src/manifest.yml',
    touchedOnly: false,
    useDefaultLang: false,
    markUntouched: true,
    extension: '.yml',
  }))
  .pipe(gulp.dest('src/_locales'));
}

function logError(err) {
  log(err.toString());
  return this.emit('end');
}

function copyZip() {
  return gulp.src([
    'node_modules/@zip.js/zip.js/dist/zip-no-worker.min.js',
    'node_modules/@zip.js/zip.js/dist/z-worker.js',
  ])
  .pipe(gulp.dest(`${DIST}/public/lib`));
}

const pack = gulp.parallel(createIcons, copyI18n, copyZip);

exports.clean = clean;
exports.manifest = manifest;
exports.dev = gulp.parallel(gulp.series(pack, watch), jsDev);
exports.build = gulp.series(clean, gulp.parallel(pack, jsProd));
exports.i18n = updateI18n;
exports.check = checkI18n;
exports.copyI18n = copyI18n;
exports.bump = bump;

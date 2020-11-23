const fs = require('fs').promises;
const gulp = require('gulp');
const del = require('del');
const log = require('fancy-log');
const gulpFilter = require('gulp-filter');
const uglify = require('gulp-uglify');
const plumber = require('gulp-plumber');
const yaml = require('js-yaml');
const Sharp = require('sharp');
const { isProd } = require('@gera2ld/plaid/util');
const spawn = require('cross-spawn');
const i18n = require('./scripts/i18n');
const { getVersion } = require('./scripts/version-helper');
const pkg = require('./package.json');

const DIST = 'dist';
const paths = {
  manifest: 'src/manifest.yml',
  copy: [
    'src/public/lib/**',
  ],
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
  gulp.watch(paths.copy, copyFiles);
  gulp.watch(paths.locales.concat(paths.templates), copyI18n);
}

async function jsDev() {
  require('@gera2ld/plaid-webpack/bin/develop')();
}

async function jsProd() {
  return require('@gera2ld/plaid-webpack/bin/build')({
    api: true,
    keep: true,
  });
}

async function readManifest() {
  const input = await fs.readFile(paths.manifest, 'utf8');
  const data = yaml.safeLoad(input);
  return data;
}

/**
 * Versioning
 *
 * The version of extension is composed of `version` and `beta` fields in `package.json`, i.e.
 *
 * Note: prerelease is ignored and not recommended since both Chrome and Firefox do not support semver
 *
 */
async function manifest() {
  const data = await readManifest();
  data.version = getVersion();
  if (process.env.TARGET === 'selfHosted') {
    data.browser_specific_settings.gecko.update_url = 'https://raw.githubusercontent.com/violentmonkey/violentmonkey/master/updates.json';
  }
  await fs.writeFile(`${DIST}/manifest.json`, JSON.stringify(data), 'utf8');
}

async function createIcons() {
  const ALPHA = .5;
  const dist = `${DIST}/public/images`;
  await fs.mkdir(dist, { recursive: true });
  const icon = Sharp(`src/resources/icon${pkg.beta ? '-beta' : ''}.png`);
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
    if (size < 48) res = res.sharpen(size < 32 ? .5 : .25);
    return res.toFile(`${dist}/icon${size}${type}.png`);
  };
  const handle16 = async ([type, image]) => {
    const res = image.clone()
    .resize({ width: 18 })
    .sharpen(.5, 0)
    .extract({ left: 1, top: 2, width: 16, height: 16 });
    // darken the outer edge
    return res.composite([{ input: await res.toBuffer(), blend: 'over' }])
    .toFile(`${dist}/icon16${type}.png`);
  };
  return Promise.all([
    handle(48),
    handle(128),
    ...types.map(handle16),
    ...[19, 32, 38].flatMap(size => types.map(t => handle(size, ...t))),
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
  await fs.writeFile('package.json', JSON.stringify(pkg, null, 2), 'utf8');
  if (process.argv.includes('--commit')) {
    const version = `v${getVersion()}`;
    spawn.sync('git', ['commit', '-am', version]);
    spawn.sync('git', ['tag', '-m', version, version]);
  }
}

/**
 * Create an update manifest file to announce a new self-hosted release.
 */
async function updateVersions() {
  const manifest = await readManifest();
  const version = getVersion();
  const data = {
    addons: {
      [manifest.browser_specific_settings.gecko.id]: {
        updates: [
          {
            version,
            update_link: `https://github.com/violentmonkey/violentmonkey/releases/download/v${version}/violentmonkey-${version}-an.fx.xpi`,
          },
        ],
      }
    },
  };
  await fs.writeFile('updates.json', JSON.stringify(data, null, 2), 'utf8');
}

function copyFiles() {
  const jsFilter = gulpFilter(['**/*.js'], { restore: true });
  let stream = gulp.src(paths.copy, { base: 'src' });
  if (isProd) stream = stream
  .pipe(jsFilter)
  .pipe(uglify())
  .pipe(jsFilter.restore);
  return stream
  .pipe(gulp.dest(DIST));
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

const pack = gulp.parallel(manifest, createIcons, copyFiles, copyI18n);

exports.clean = clean;
exports.dev = gulp.series(gulp.parallel(pack, jsDev), watch);
exports.build = gulp.series(clean, gulp.parallel(pack, jsProd));
exports.i18n = updateI18n;
exports.check = checkI18n;
exports.copyI18n = copyI18n;
exports.bump = bump;
exports.updateVersions = updateVersions;

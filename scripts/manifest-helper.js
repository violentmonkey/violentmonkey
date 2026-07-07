const fs = require('fs');
const yaml = require('js-yaml');
const { getVersion, isBeta } = require('./version-helper');
const { MV3, isProd } = require('./common');

function getBrowserTargets() {
  const manifest = readManifest();
  const CH = parseInt(manifest.minimum_chrome_version);
  const FF = parseInt(manifest.browser_specific_settings?.gecko.strict_min_version);
  return [
    CH && `Chrome >= ${CH}`,
    FF && `Firefox >= ${FF}`,
  ].filter(Boolean).join(',');
}

function readManifest() {
  const input = fs.readFileSync('src/manifest.yml', 'utf8');
  const data = yaml.load(MV3 ? input.replaceAll('browser_action', 'action') : input);
  if (MV3) Object.assign(data, {
    manifest_version: 3,
    minimum_chrome_version: '135.0', // chrome.userScripts.execute
    background: { service_worker: 'sw.js' },
    browser_specific_settings: undefined,
    content_scripts: undefined,
    incognito: 'split',
    // TODO: use it when it graduates from Canary into Stable
    // message_serialization: 'structured_clone',
    host_permissions: ['<all_urls>'],
    permissions: data.permissions.filter(p => p !== '<all_urls>' && p !== 'webRequestBlocking').concat([
      'alarms',
      'declarativeNetRequestWithHostAccess',
      !isProd && 'declarativeNetRequestFeedback',
      'identity',
      'offscreen',
      'scripting',
      'userScripts',
      'webNavigation',
    ].filter(Boolean)),
  });
  return data;
}

function buildManifest(base) {
  const data = base ? { ...base } : readManifest();
  data.version = getVersion();
  if (process.env.TARGET === 'selfHosted') {
    data.browser_specific_settings.gecko.update_url = 'https://raw.githubusercontent.com/violentmonkey/violentmonkey/updates/updates.json';
  }
  if (isBeta()) {
    // Do not support i18n in beta version
    const name = 'Violentmonkey BETA';
    data.name = name;
    data[MV3 ? 'action' : 'browser_action'].default_title = name;
  }
  return data;
}

function buildUpdatesList(version, url) {
  const manifest = readManifest();
  const data = {
    addons: {
      [manifest.browser_specific_settings.gecko.id]: {
        updates: [
          {
            version,
            update_link: url,
          },
        ],
      },
    },
  };
  return data;
}

class ListBackgroundScriptsPlugin {
  constructor({ minify } = {}) {
    this.minify = minify;
  }

  apply(compiler) {
    compiler.hooks.afterEmit.tap(this.constructor.name, compilation => {
      const dist = compilation.outputOptions.path;
      const path = `${dist}/manifest.json`;
      const manifest = buildManifest();
      const bgId = 'background/index';
      const bgEntry = compilation.entrypoints.get(bgId);
      const scripts = bgEntry.chunks.flatMap(c => [...c.files]);
      if (`${manifest.background.scripts}` !== `${scripts}`) {
        manifest.background.scripts = scripts;
        fs.writeFileSync(path,
          JSON.stringify(manifest, null, this.minify ? 0 : 2),
          { encoding: 'utf8' });
      }
    });
  }
}

exports.getBrowserTargets = getBrowserTargets;
exports.readManifest = readManifest;
exports.buildManifest = buildManifest;
exports.buildUpdatesList = buildUpdatesList;
exports.ListBackgroundScriptsPlugin = ListBackgroundScriptsPlugin;

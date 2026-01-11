const fs = require('fs').promises;
const yaml = require('js-yaml');
const { getVersion, isBeta } = require('./version-helper');

async function readManifest() {
  const input = await fs.readFile('src/manifest.yml', 'utf8');
  const data = yaml.load(input);
  return data;
}

function isHostPermission(value) {
  return value === '<all_urls>' || value.includes('://');
}

function uniq(values) {
  return [...new Set(values)];
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensurePermissions(permissions, required) {
  return uniq([...permissions, ...required]);
}

function buildManifestForTarget(target, baseManifest, buildInfo = {}) {
  const data = baseManifest ? { ...baseManifest } : {};
  data.version = getVersion();
  if (target === 'selfHosted') {
    data.browser_specific_settings.gecko.update_url = 'https://raw.githubusercontent.com/violentmonkey/violentmonkey/updates/updates.json';
  }
  if (isBeta()) {
    // Do not support i18n in beta version
    const name = 'Violentmonkey BETA';
    data.name = name;
    if (data.browser_action) data.browser_action.default_title = name;
    if (data.action) data.action.default_title = name;
  }
  if (target === 'chromeMV3') {
    data.manifest_version = 3;
    if (data.browser_action && !data.action) {
      data.action = data.browser_action;
    }
    delete data.browser_action;
    delete data.content_scripts;
    const background = { ...(data.background || {}) };
    delete background.scripts;
    if (buildInfo.serviceWorker) {
      background.service_worker = buildInfo.serviceWorker;
    }
    data.background = background;
    const permissions = toArray(data.permissions).filter(p => ![
      'webRequest',
      'webRequestBlocking',
    ].includes(p));
    const hostPermissions = toArray(data.host_permissions);
    const remainingPermissions = [];
    for (const permission of permissions) {
      if (isHostPermission(permission)) {
        hostPermissions.push(permission);
      } else {
        remainingPermissions.push(permission);
      }
    }
    data.host_permissions = uniq(hostPermissions);
    data.permissions = ensurePermissions(remainingPermissions, [
      'storage',
      'tabs',
      'scripting',
      'userScripts',
      'offscreen',
      'cookies',
    ]);
    if (data.commands?._execute_browser_action) {
      data.commands._execute_action = data.commands._execute_browser_action;
      delete data.commands._execute_browser_action;
    }
    if (Array.isArray(data.web_accessible_resources)
    && data.web_accessible_resources.length
    && typeof data.web_accessible_resources[0] === 'string') {
      data.web_accessible_resources = [{
        resources: data.web_accessible_resources,
        matches: ['<all_urls>'],
      }];
    }
    data.minimum_chrome_version = '120.0';
    delete data.browser_specific_settings;
  } else if (buildInfo.backgroundScripts) {
    data.background = { ...(data.background || {}) };
    data.background.scripts = buildInfo.backgroundScripts;
  }
  return data;
}

async function buildManifest(base, buildInfo) {
  const data = base ? { ...base } : await readManifest();
  return buildManifestForTarget(process.env.TARGET, data, buildInfo);
}

async function buildUpdatesList(version, url) {
  const manifest = await readManifest();
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
    compiler.hooks.afterEmit.tap(this.constructor.name, async compilation => {
      const dist = compilation.outputOptions.path;
      const path = `${dist}/manifest.json`;
      const target = process.env.TARGET;
      const bgId = 'background/index';
      const bgEntry = compilation.entrypoints.get(bgId);
      const entryFiles = bgEntry.getFiles();
      const scripts = bgEntry.chunks.flatMap(c => [...c.files]);
      const serviceWorker = entryFiles.find(file => file === `${bgId}.js`)
        || entryFiles.find(file => file.startsWith(`${bgId}.`) && file.endsWith('.js'))
        || entryFiles[0];
      const manifest = await buildManifest(null, {
        backgroundScripts: scripts,
        serviceWorker,
      });
      let shouldWrite = true;
      try {
        const existing = JSON.parse(await fs.readFile(path, 'utf8'));
        shouldWrite = target === 'chromeMV3'
          ? existing.background?.service_worker !== serviceWorker
          : `${existing.background?.scripts}` !== `${scripts}`;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (shouldWrite) {
        await fs.writeFile(path,
          JSON.stringify(manifest, null, this.minify ? 0 : 2),
          { encoding: 'utf8' });
      }
    });
  }
}

exports.readManifest = readManifest;
exports.buildManifest = buildManifest;
exports.buildManifestForTarget = buildManifestForTarget;
exports.buildUpdatesList = buildUpdatesList;
exports.ListBackgroundScriptsPlugin = ListBackgroundScriptsPlugin;

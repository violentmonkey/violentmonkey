# Violentmonkey

## Astrophage builds for Orion

[Download the latest Orion build](https://github.com/Astrophage-IO/violentmonkey/releases/latest/download/violentmonkey-orion.zip) · [All releases](https://github.com/Astrophage-IO/violentmonkey/releases) · [Build status](https://github.com/Astrophage-IO/violentmonkey/actions/workflows/fork-release.yml)

Each push to `master`, including a merged PR, publishes tested MV2 and MV3 packages as a GitHub release. The Orion ZIP uses MV2. Versions increase automatically, and the download link stays the same. Maintainers can also run the **Astrophage release** workflow manually on `master`.

On iPad, download the Orion ZIP, then use **Orion → Extensions → + → Install from File** and select it. On Mac, use **Tools → Extensions → Manage Extensions → Add Extension → Install from Disk**. If migrating from upstream Violentmonkey, export your scripts and values first, install this fork, import the export, and disable the old copy. This fork has its own extension identity, so data does not migrate automatically.

The installed manifests point to this repository's latest-release update feeds: `updates-crx.xml` for MV2, `updates-mv3.xml` for MV3, and `updates.json` for the Firefox-format package. Every CRX is signed with the same key. Feed entries reference versioned release files, preventing a newer release from changing a download already in progress. `SHA256SUMS` covers the published packages and feeds. The XPI is unsigned by Mozilla and is intended for Orion, not ordinary Firefox installations.

Orion controls extension updates. Its [automatic-update documentation](https://help.kagi.com/orion/features/automatic-extension-updates.html) describes store-installed extensions; support for automatic GitHub-feed updates on iPad has not been verified. Enable **Automatic updates** in Orion's extension settings where available. A new release being published does not prove Orion will install it automatically; the stable download link also works for manual updates.

For maintainers: `ASTROPHAGE_CRX_PRIVATE_KEY` is the persistent GitHub Actions signing secret, matched against `scripts/fork-public-key.pem`. Keep a secure backup and preserve this key across releases; replacing it changes the Chromium extension identity. The workflow refuses to sign with a different key or replace the latest release with an older version.

## Upstream Violentmonkey

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/jinjaccalgkegednnccohejagnlnfdag.svg)](https://chrome.google.com/webstore/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag)
[![Firefox Add-ons](https://img.shields.io/amo/v/violentmonkey.svg)](https://addons.mozilla.org/firefox/addon/violentmonkey)
[![Microsoft Edge Add-on](https://img.shields.io/badge/dynamic/json?label=microsoft%20edge%20add-on&query=%24.version&url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Feeagobfjdenkkddmbclomhiblgggliao)](https://microsoftedge.microsoft.com/addons/detail/eeagobfjdenkkddmbclomhiblgggliao)

Violentmonkey provides userscripts support for browsers.
It works on browsers with [WebExtensions](https://developer.mozilla.org/en-US/Add-ons/WebExtensions) support.

More details can be found [here](https://violentmonkey.github.io/).

Join our Discord server:

[![Discord](https://img.shields.io/discord/995346102003965952?label=discord&logo=discord&logoColor=white&style=for-the-badge)](https://discord.gg/XHtUNSm6Xc)

## Automated Builds for Testers

* [CI workflows](https://github.com/violentmonkey/violentmonkey/actions/workflows/ci.yml) (only for signed-in github.com users)
* [nightly.link latest](https://nightly.link/violentmonkey/violentmonkey/workflows/ci/master?preview) (to download any other build replace `github.com` with `nightly.link` in the artifact URL)

A test build is generated automatically for changes between beta releases. It can be installed as an unpacked extension in Chrome and Chromium-based browsers or as a temporary extension in Firefox. It's likely to have bugs so do an export in Violentmonkey settings first. This zip is available only if you're logged-in on GitHub site. Open an entry in the [CI workflows](https://github.com/violentmonkey/violentmonkey/actions/workflows/ci.yml) table and click the `Violentmonkey-...` link at the bottom to download it.

## Workflows

### Development

Install [Node.js](https://nodejs.org/) and PNPM.
The version of Node.js should match `"node"` key in `package.json`.

``` sh
# Install dependencies
$ pnpm ci

# Watch and compile
$ pnpm dev
```

Then load the extension from 'dist/'.

### Test + lint

``` sh
$ pnpm run ci
```

### Build

To release a new version, we must build the assets and upload them to web stores.

``` sh
# Build for normal releases
$ pnpm build

# Build for self-hosted release that has an update_url
$ pnpm build:selfHosted
```

### Release

See [RELEASE](RELEASE.md) for the release flow.

## Related Projects

- [Violentmonkey for Opera Presto](https://github.com/violentmonkey/violentmonkey-oex)
- [Violentmonkey for Maxthon](https://github.com/violentmonkey/violentmonkey-mx)

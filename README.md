# Violentmonkey

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/jinjaccalgkegednnccohejagnlnfdag.svg)](https://chrome.google.com/webstore/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag)
[![Firefox Add-ons](https://img.shields.io/amo/v/violentmonkey.svg)](https://addons.mozilla.org/firefox/addon/violentmonkey)
[![Microsoft Edge Add-on](https://img.shields.io/badge/dynamic/json?label=microsoft%20edge%20add-on&query=%24.version&url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Feeagobfjdenkkddmbclomhiblgggliao)](https://microsoftedge.microsoft.com/addons/detail/eeagobfjdenkkddmbclomhiblgggliao)
[![Gitter](https://img.shields.io/gitter/room/violentmonkey/violentmonkey.svg)](https://gitter.im/violentmonkey/violentmonkey)
[![TravisCI](https://travis-ci.org/violentmonkey/violentmonkey.svg?branch=master)](https://travis-ci.org/violentmonkey/violentmonkey)

Violentmonkey provides userscripts support for browsers.
It works on browsers with [WebExtensions](https://developer.mozilla.org/en-US/Add-ons/WebExtensions) support.

More details can be found [here](https://violentmonkey.github.io/).

## Related projects

- [Violentmonkey for Opera Presto](https://github.com/violentmonkey/violentmonkey-oex)
- [Violentmonkey for Maxthon](https://github.com/violentmonkey/violentmonkey-mx)

## Workflows

### Development

Make sure [Node.js](https://nodejs.org/) greater than v10.0 and Yarn v1.x is installed.

``` sh
# Install dependencies
$ yarn

# Watch and compile
$ yarn dev
```

Then load the extension from 'dist/'.

### Building

After a new (pre)release is created, we should build the project and upload to web stores.

``` sh
# Build for normal releases
$ yarn build

# Build for self-hosted release that has an update_url
$ yarn build:selfHosted
```

## Release

Just create a tag and push it.

When a tag is pushed to GitHub, a (pre)release will be created with assets built by GitHub Actions.

```sh
# Create a prerelease
$ yarn bump

# Create a patch release
$ yarn version --patch
```

### Announcing updates

Create a new `updates.json` so that self-hosted versions can be updated to the new version.

```sh
$ yarn update:selfHosted
```

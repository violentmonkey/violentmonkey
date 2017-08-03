Violentmonkey
=============

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/jinjaccalgkegednnccohejagnlnfdag.svg)](https://chrome.google.com/webstore/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag)
[![Gitter](https://img.shields.io/gitter/room/violentmonkey/violentmonkey.svg)](https://gitter.im/violentmonkey/violentmonkey)

Violentmonkey provides userscripts support for browsers.
It works on browsers with [WebExtensions](https://developer.mozilla.org/en-US/Add-ons/WebExtensions) support.

More details can be found [here](https://violentmonkey.github.io/).

Related projects
---
- [Violentmonkey for Opera Presto](https://github.com/violentmonkey/violentmonkey-oex)
- [Violentmonkey for Maxthon](https://github.com/violentmonkey/violentmonkey-mx)

Development
---
Make sure [Node.js](https://nodejs.org/) v8+ is installed.
``` sh
$ npm i
$ npm run dev
# Then load the extension from 'dist/'.
```

Build
---
``` sh
# Build without compression
$ npm run build

# Build a compressed version
$ npm run build:min
```

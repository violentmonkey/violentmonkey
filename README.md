Violentmonkey
=============

Violentmonkey provides userscripts support for Chromium-based Opera.  
Violentmonkey for Opera Presto: <https://github.com/Violentmonkey/Violentmonkey-oex>

Language localization
---
* You may download `src/_locales/en/messages.yml` and translate it into your
  own language, and then make a pull request.

* If you are working with an existed locale file, the newly added items will
  have empty `message`s.
  You may then check out `src/_locales/en/messages.yml` for the English version and
  translate it, or just leave it blank to use the English version as a fallback.

Development
---
``` sh
$ npm i
$ npm run dev
# Then load the extension from 'dist/'.
```

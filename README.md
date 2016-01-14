Violentmonkey
=============

Violentmonkey provides userscripts support for Chromium-based Opera.  
Violentmonkey for Opera Presto: <https://github.com/Violentmonkey/Violentmonkey-oex>

Multiple language
---
* You may download `src/_locales/en/messages.json` and translate it into your
  own language, and then make a pull request.

* If you are working with an existed language file, the newly added items will
  have empty `message`s.
  You may then check out `src/_locales/en/messages.json` for the English version
  and translate it.

Development
---
Run command below:

``` sh
$ npm run dev
```

Then you can load the extension from `dist/`.

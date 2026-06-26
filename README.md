<div align="center">

<img src="https://raw.githubusercontent.com/wiki/OpenUserJS/OpenUserJS.org/images/violentmonkey_icon.min.svg?sanitize=true" width="88" alt="Violentmonkey">

<h1>ViolentMonkey — AddDomain Fork</h1>

<p><b>Add any domain to a script's <code>@match</code> rules in one tap — directly from the popup or dashboard.</b></p>

[![CI](https://img.shields.io/github/actions/workflow/status/BlazeFTL/ViolentMonkey_AddDomain/ci.yml?branch=master&label=CI&logo=github&style=flat-square)](https://github.com/BlazeFTL/ViolentMonkey_AddDomain/actions)
[![Upstream](https://img.shields.io/badge/upstream-violentmonkey-7c3aed?style=flat-square&logo=github)](https://github.com/violentmonkey/violentmonkey)
[![Platform](https://img.shields.io/badge/Firefox-Android-FF6611?style=flat-square&logo=firefox-browser&logoColor=white)](https://addons.mozilla.org/firefox/addon/violentmonkey/)

</div>

---

## What This Fork Adds

Upstream Violentmonkey has no built-in way to add a domain to a script's `@match` without manually editing its header. This fork fixes that.

| Feature | Where |
|---|---|
| **"+" button** — add current tab's domain to any script | Popup |
| **Domain input panel** — type or paste a domain, hit Add | Dashboard |
| **"Current tab" button** — pre-fills last popup tab's domain | Dashboard |
| **Shorthand expansion** — commas & bare domains auto-expanded on save | Editor |
| **Wildcard TLD** — generates `example.*` alongside `example.com` | Both |

---

## Shorthand Expansion

You no longer need to write out full `@match` boilerplate. Type shorthand — it's expanded automatically when you save.

```js
// Before saving          →   After saving
// @match  example.com        // @match  *://example.com/*
// @match  example.com,xyz.*  // @match  *://example.com/*
                              // @match  *://xyz.*/*
```

> Already-valid patterns (containing `://` and a path) are left exactly as-is.

---

ScreenShots
<img width="702" height="1560" alt="Screenshot_20260626-151626_Spark Launcher" src="https://github.com/user-attachments/assets/d62fff25-34c4-43f9-ad6a-747c1446253e" />
<img width="702" height="1560" alt="Screenshot_20260626-153758_Spark Launcher" src="https://github.com/user-attachments/assets/43a6e2f1-449d-401c-8e6a-c4f11b890cb2" />
<img width="702" height="1560" alt="Screenshot_20260626-153833_Spark Launcher" src="https://github.com/user-attachments/assets/053938d8-c11f-4fd8-adcd-f7b83ae78d6c" />
<img width="702" height="1560" alt="Screenshot_20260626-153840_Spark Launcher" src="https://github.com/user-attachments/assets/8f332b42-0ec3-4bf7-b4c9-c652060130cd" />

## Installation

### Download a pre-built build

1. Go to [**Releases**](../../releases) → pick the latest
   - `V2.x.x` — stable build
   - `V2.x.x-beta` — beta build (based on upstream beta)
2. Download the `.zip` artifact
3. In Firefox: open `about:debugging` → **Load Temporary Add-on** → pick any file inside the zip

### Build from source

```bash
git clone https://github.com/BlazeFTL/ViolentMonkey_AddDomain
cd ViolentMonkey_AddDomain
pnpm i
python3 apply_patches_addmatch.py   # apply fork patches
pnpm build                          # output → dist/
```

---

## How the CI Works

Every push to `master` automatically:

```
Checkout → Apply Patches → Install → Test → Build → Upload Artifact → Create Release
```

- **Patch step** runs `apply_patches_addmatch.py` before anything else
- **Artifact & release name** is derived from `package.json` version + beta flag
- Releases are created/updated automatically — no manual tagging needed

---

## Credits

Built on top of [violentmonkey/violentmonkey](https://github.com/violentmonkey/violentmonkey).  
All original license terms apply — see [LICENSE](LICENSE).

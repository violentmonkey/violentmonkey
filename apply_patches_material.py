#!/usr/bin/env python3
"""
Material light/dark UI theme for the Violentmonkey fork (popup, dashboard, editor chrome).
Run after apply_patches_addmatch.py from the repo root:

    python3 apply_patches_addmatch.py && python3 apply_patches_material.py [repo_root]
"""
import sys
from pathlib import Path

# Each patch: (file, old, new). `old` must appear EXACTLY once in `file`.
PATCHES = [
    (
        'src/common/ui/style/index.js',
        r"""import './style.css';""",
        r"""import './style.css';
import './material.css';""",
    ),
]

NEW_FILES = {
    'src/common/ui/style/material.css': r"""/* Material theme (light first, dark follows prefers-color-scheme / uiTheme).
 * Loaded after style.css. Tokens at :root:root; component rules under :root:root:root
 * so they beat SFC <style> blocks and popup/options sheets regardless of bundle order. */

:root:root {
  accent-color: var(--md-primary);

  --md-primary: #8400ff;
  --md-on-primary: #ffffff;
  --md-primary-container: #ecdcff;
  --md-on-primary-container: #2b0069;
  --md-secondary-container: #ffe3d8;
  --md-on-secondary-container: #5b2210;
  --md-error: #d92f2f;
  --md-error-container: #ffdad6;
  --md-on-error-container: #7d1212;
  --md-state-hover: rgba(132, 0, 255, .08);
  --md-state-press: rgba(132, 0, 255, .16);
  --md-scrim: rgba(29, 20, 40, .42);
  --md-shadow-1: 0 1px 2px rgba(48, 16, 88, .16), 0 1px 3px 1px rgba(48, 16, 88, .10);
  --md-shadow-2: 0 1px 2px rgba(48, 16, 88, .18), 0 2px 6px 2px rgba(48, 16, 88, .12);
  --md-shadow-3: 0 2px 4px rgba(48, 16, 88, .20), 0 8px 16px 4px rgba(48, 16, 88, .14);
  --hbg: var(--fill-1);

  --fill-0: #fffbfe;
  --fill-0-5: #f8f3fb;
  --fill-1: #f3edf7;
  --fill-2: #e8e0ee;
  --fill-3: #ddd5e4;
  --fill-4: #cac4d0;
  --fill-5: #b5aebf;
  --fill-6: #9d97a8;
  --fill-7: #7a7485;
  --fill-8: #6f6979;
  --fill-9: #625c6c;
  --fill-10: #565060;
  --fill-11: #49454f;
  --fill-12: #3c3844;
  --fill-13: #2f2b37;
  --fill-14: #25212c;
  --fill-15: #1d1b20;
  --focus-border-color: var(--md-primary);
  --tooltip-bg: #322f3a;
  --tooltip-color: #f5eff7;
}

@media (prefers-color-scheme: dark) {
  :root:root {
    --md-primary: #d4b8ff;
    --md-on-primary: #3a0080;
    --md-primary-container: #4f00a8;
    --md-on-primary-container: #ecdcff;
    --md-secondary-container: #5b2b1b;
    --md-on-secondary-container: #ffdbcd;
    --md-error: #ff8a80;
    --md-error-container: #5c1414;
    --md-on-error-container: #ffdad6;
    --md-state-hover: rgba(212, 184, 255, .10);
    --md-state-press: rgba(212, 184, 255, .18);
    --md-scrim: rgba(0, 0, 0, .6);
    --md-shadow-1: 0 1px 2px rgba(0, 0, 0, .5), 0 1px 3px 1px rgba(0, 0, 0, .35);
    --md-shadow-2: 0 1px 2px rgba(0, 0, 0, .5), 0 2px 6px 2px rgba(0, 0, 0, .4);
    --md-shadow-3: 0 2px 4px rgba(0, 0, 0, .55), 0 8px 16px 4px rgba(0, 0, 0, .45);

    --fill-0: #141218;
    --fill-0-5: #1a181f;
    --fill-1: #211f26;
    --fill-2: #2b2930;
    --fill-3: #36343b;
    --fill-4: #49454f;
    --fill-5: #5a5562;
    --fill-6: #6e6978;
    --fill-7: #857f8f;
    --fill-8: #9a94a4;
    --fill-9: #aea8b8;
    --fill-10: #c0bac9;
    --fill-11: #cac4d0;
    --fill-12: #d9d3e0;
    --fill-13: #e6e0e9;
    --fill-14: #f1ecf4;
    --fill-15: #ffffff;
    --input-bg: var(--fill-1);
    --tooltip-bg: #e6e0e9;
    --tooltip-color: #322f3a;
  }
}

a {
  color: var(--md-primary);
}

:root:root:root {
  /* ---------- base elements ---------- */
  mark {
    padding: 0 .15em;
    border-radius: 4px;
    background: var(--md-secondary-container);
    color: inherit;
  }
  kbd,
  code {
    padding: .05em .4em;
    border-radius: 6px;
    background: var(--md-secondary-container);
    color: var(--md-on-secondary-container);
  }
  fieldset {
    border: 1px solid var(--fill-3);
    border-radius: 12px;
  }
  hr {
    border-color: var(--fill-3);
  }
  :focus-visible {
    outline: 2px solid var(--md-primary);
    outline-offset: 2px;
  }
  input:focus-visible,
  select:focus-visible,
  textarea:focus-visible {
    outline: none;
  }

  input[type=checkbox],
  input[type=radio] {
    width: 1.15em;
    height: 1.15em;
    margin-right: .45em;
    vertical-align: -.2em;
  }

  input[type=text],
  input[type=url],
  input[type=search],
  input[type=number],
  input[type=password],
  select,
  textarea {
    padding-left: .7em;
    padding-right: .7em;
    border: 1px solid var(--fill-4);
    border-radius: 10px;
    background: var(--bg);
    color: var(--fg);
    transition: border-color .15s, box-shadow .15s;
    &:focus {
      border-color: var(--md-primary);
      box-shadow: 0 0 0 1px var(--md-primary);
    }
    &[disabled] {
      background: var(--fill-1);
    }
  }
  input[type=text],
  input[type=url],
  input[type=search],
  input[type=number],
  input[type=password],
  select {
    min-height: 2.2rem;
  }
  textarea {
    padding-top: .5em;
    padding-bottom: .5em;
  }
  select {
    padding-left: .6em;
    padding-right: .4em;
  }

  button:not(.btn-ghost) {
    height: 2.3rem;
    padding: 0 1.1rem;
    border: 0;
    border-radius: 20px;
    background: var(--md-primary-container);
    color: var(--md-on-primary-container);
    font-weight: 500;
    letter-spacing: .01em;
    transition: box-shadow .15s;
    &:not([disabled]):hover {
      border: 0;
      box-shadow: inset 0 0 0 100px var(--md-state-hover), var(--md-shadow-1);
    }
    &:not([disabled]):active {
      background: var(--md-primary-container);
      box-shadow: inset 0 0 0 100px var(--md-state-press);
    }
    &[disabled] {
      opacity: .38;
    }
  }

  .btn-ghost {
    min-width: 2.5rem;
    justify-content: center;
    border: 0;
    border-radius: 12px;
    color: var(--fill-11);
    &:focus,
    &:focus-within,
    &:hover {
      border: 0;
      background: var(--md-state-hover);
    }
    &:active {
      background: var(--md-state-press);
    }
    &.active {
      border: 0;
      background: var(--md-state-press);
      color: var(--md-primary);
    }
  }
  .btn-danger {
    color: var(--md-error);
  }
  .toggle-button {
    border: 0;
    background: var(--fill-2);
    color: var(--fill-12);
    &.active {
      background: var(--md-primary);
      color: var(--md-on-primary);
    }
  }

  .has-error,
  .btn-ghost.has-error,
  input[type].has-error {
    border-color: var(--md-error);
    background: var(--md-error-container);
  }

  /* ---------- overlays ---------- */
  .modal-content {
    border-radius: 0 0 24px 24px;
    background: var(--fill-0);
    box-shadow: var(--md-shadow-3);
  }
  .vl-modal-backdrop {
    background: var(--md-scrim);
  }
  .vl-dropdown-menu {
    padding: .5rem;
    border: 0;
    border-radius: 14px;
    background: var(--fill-0);
    box-shadow: var(--md-shadow-2);
  }
  body .vl-tooltip-content {
    border-radius: 8px;
    padding: .25rem .6rem;
  }
  .vm-toast {
    border-radius: 0 0 16px 16px;
    background: var(--md-secondary-container);
    color: var(--md-on-secondary-container);
    box-shadow: var(--md-shadow-2);
  }
  .add-match-note {
    border-radius: 12px;
    background: var(--md-error-container);
    color: var(--md-on-error-container);
  }

  /* ---------- popup ---------- */
  .page-popup {
    background: var(--bg);
    a {
      color: inherit;
    }
    footer {
      border-top: 1px solid var(--fill-2);
      a[href] {
        color: var(--fill-7);
      }
    }
    .menu,
    .menu:not(.expand) + footer {
      border-top: 0;
    }
    .menu:not(.expand) + footer {
      border-top: 1px solid var(--fill-2);
    }

    .menu-area {
      border-radius: 16px;
      &:hover,
      &:focus {
        background: var(--md-state-hover);
        color: inherit;
      }
      &:active {
        background: var(--md-state-press);
      }
    }

    .menu-buttons {
      gap: 2px;
      min-height: 60px;
      padding: 8px 8px 8px 16px;
      background: var(--bg);
      .logo {
        margin: 0 12px 0 0;
        img {
          display: block;
          width: 36px;
        }
      }
      .ext-name {
        min-width: 0;
        font-size: 16px;
        font-weight: 500;
        line-height: 1.25;
        overflow-wrap: anywhere;
      }
      > .menu-area {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        margin: 0;
        padding: 0;
        border-radius: 50%;
        color: var(--fill-11);
        &:last-child {
          margin: 0;
        }
        &:first-of-type {
          width: 56px;
          border-radius: 22px;
        }
        .icon {
          width: 24px;
          height: 24px;
        }
        &:first-of-type .icon {
          width: 40px;
          height: 28px;
        }
      }
    }
    &[data-is-applied="true"] .menu-buttons > .menu-area:first-of-type {
      color: var(--md-primary);
    }
    &[data-is-applied="false"] .menu-buttons > .menu-area:first-of-type {
      color: var(--fill-6);
    }

    .menu-find {
      min-height: 48px;
      margin: 0 12px 8px;
      padding-left: 16px;
      padding-right: 16px;
      border-radius: 24px;
      background: var(--fill-1);
      &:hover,
      &:focus {
        background: var(--fill-1);
      }
      a {
        min-height: 48px;
        color: var(--fill-12);
      }
      .icon {
        flex-basis: 20px;
        width: 20px;
        height: 20px;
        margin: 0 10px 0 0;
        color: var(--md-primary);
      }
    }

    .menu-group {
      min-height: 48px;
      padding-left: 20px;
      color: var(--md-primary);
      font-size: 14px;
      font-weight: 600;
      letter-spacing: .01em;
      .icon-collapse {
        flex-basis: 20px;
        width: 20px;
        height: 20px;
      }
    }
    .menu.expand {
      > .menu-group {
        position: sticky;
        top: 0;
        z-index: 2;
        border-radius: 0;
        background: var(--bg);
        &:hover,
        &:focus {
          background: var(--fill-1);
        }
      }
      > .submenu {
        border-color: transparent;
      }
    }

    .submenu {
      padding-bottom: 8px;
      border-top: 0;
      > .script {
        margin: 2px 8px;
        border-radius: 16px;
      }
    }

    .script {
      > .menu-item {
        min-height: 52px;
        padding: 6px 10px 6px 0;
        border-radius: 16px;
      }
      .script-icon {
        left: 12px;
        width: 28px;
        height: 28px;
        max-width: 28px;
        max-height: 28px;
        margin: 0;
        border-radius: 6px;
        object-fit: contain;
        & + .icon {
          flex: 0 0 34px;
          width: 34px;
          height: 24px;
          margin-left: 52px;
          margin-right: 12px;
        }
      }
      > .menu-item > .icon {
        color: var(--fill-6);
      }
      &:not(.disabled) > .menu-item > .icon {
        color: var(--md-primary);
      }
      .script-name {
        font-size: 15px;
        line-height: 1.3;
        white-space: normal;
        > .ellipsis {
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          line-clamp: 2;
          white-space: normal;
          overflow: hidden;
          text-overflow: ellipsis;
          overflow-wrap: anywhere;
        }
      }
      &.disabled .script-name {
        color: var(--fill-8);
      }
      &:not(.disabled) .script-name {
        color: var(--fill-15);
      }
    }
    .submenu-buttons {
      right: 4px;
      align-items: center;
      height: 52px;
      padding-left: 4px;
      background: var(--bg);
      border-radius: 0 16px 16px 0;
      &::before {
        content: '';
        flex: 0 0 1px;
        height: 28px;
        margin-right: 4px;
        background: var(--fill-3);
      }
    }
    .submenu-button {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      padding: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--fill-10);
      &:hover,
      &:focus {
        background: var(--md-state-press);
        color: var(--md-primary);
      }
      .icon {
        width: 22px;
        height: 22px;
        color: inherit;
      }
    }
    .menu-item:hover + .submenu-buttons .submenu-button:not(:focus):not(:hover) {
      background: transparent;
    }

    .submenu-commands {
      padding-left: 70px;
      font-size: 13px;
      color: var(--fill-10);
      summary {
        width: 70px;
        padding-left: 52px;
      }
      > .menu-item {
        min-height: 36px;
        line-height: 36px;
        border-radius: 12px;
      }
    }
    .excludes-menu,
    .add-match-menu {
      padding-top: 4px;
      padding-bottom: 12px;
      button {
        height: 2.2rem;
        padding: 0 .9rem;
      }
      input {
        min-height: 2.5rem;
      }
    }

    .failure-reason {
      margin: 8px 12px;
      padding: 12px 16px;
      border-radius: 16px;
      background: var(--md-secondary-container);
      color: var(--md-on-secondary-container);
      &.note {
        padding-left: 16px;
      }
      a {
        color: inherit;
        text-decoration: underline;
      }
    }
    &:not(.noninjectable):not(.blacklisted) .failure-reason {
      background: var(--md-secondary-container);
    }
    .incognito {
      padding-left: 20px;
      color: var(--fill-8);
    }
    .upd[title] {
      padding-left: 98px;
      color: #b25b00;
      &[data-error] {
        color: var(--md-error);
      }
    }
    .settings {
      padding: 16px;
    }
  }

  .extras-menu {
    padding: 8px 0;
    border: 0;
    border-radius: 16px;
    background: var(--fill-0);
    box-shadow: var(--md-shadow-3);
    overflow: hidden;
    > * {
      padding: 12px 20px;
      &:first-child,
      &:last-child {
        padding-top: 12px;
        padding-bottom: 12px;
      }
      &:hover,
      &:focus {
        background: var(--md-state-hover);
        color: inherit;
      }
      &:active {
        background: var(--md-state-press);
      }
    }
    > code {
      margin: 0 12px 4px;
      padding: 8px 12px;
      border: 0;
      border-radius: 10px;
    }
  }

  /* ---------- dashboard ---------- */
  aside {
    border-color: var(--fill-2);
    background: var(--fill-0-5);
  }
  .aside-menu-item a {
    color: var(--fill-9);
    font-weight: 500;
    &:hover {
      color: var(--md-primary);
      text-decoration: none;
    }
    &.active {
      color: var(--md-primary);
      font-weight: 700;
    }
  }
  aside header {
    border-color: var(--fill-3);
  }

  .tab {
    background: var(--bg);
  }
  .bright {
    --hbg: var(--md-secondary-container);
  }
  section > h3,
  [open] > .h3 {
    border-top: 0;
    background: linear-gradient(to right, var(--hbg, var(--fill-1)), transparent);
    color: var(--md-primary);
    font-size: 1rem;
    font-weight: 600;
    line-height: 2.4;
  }
  summary.h3 {
    color: var(--md-primary);
  }

  .tab.tab-installed {
    header {
      border-bottom: 1px solid var(--fill-2);
      background: var(--fill-0-5);
      .filtered {
        border-right-color: var(--fill-2);
      }
    }
    .filter-search input {
      height: 2.4rem;
      padding-left: 1rem;
      border: 1px solid transparent;
      border-radius: 24px;
      background: var(--fill-1);
      &:focus {
        border-color: var(--md-primary);
        background: var(--bg);
      }
    }
    .btn-group {
      border-right-color: var(--fill-3);
    }
  }

  .scripts .script {
    border: 1px solid var(--fill-2);
    border-radius: 16px;
    background: var(--bg);
    box-shadow: var(--md-shadow-1);
    &:hover {
      border-color: var(--fill-4);
    }
    &.focused,
    &.focused:focus {
      border-color: var(--md-primary);
      box-shadow: var(--md-shadow-2);
    }
    &.disabled,
    &.removed {
      background: var(--fill-0-5);
      box-shadow: none;
    }
    &.error {
      border-color: var(--md-error);
      .script-message {
        color: var(--md-error);
      }
    }
    .script-name {
      font-weight: 500;
      &:hover {
        color: var(--md-primary);
        text-decoration: none;
      }
    }
    .script-buttons {
      color: var(--fill-10);
    }
    .add-match-panel {
      border-top-color: var(--fill-2);
    }
  }
  .scripts[data-table] .script {
    border-radius: 0;
    box-shadow: none;
    background: none;
  }

  /* ---------- editor ---------- */
  .edit {
    --border: 1px solid var(--fill-2);
  }
  .edit-header {
    min-height: 52px;
    background: var(--fill-0-5);
    box-shadow: var(--md-shadow-1);
    border-bottom: 0;
  }
  .edit-nav-item {
    padding: 15px 16px;
    color: var(--fill-9);
    font-weight: 500;
    &.active {
      background: transparent;
      box-shadow: inset 0 -3px 0 var(--md-primary);
      color: var(--md-primary);
    }
    &:not(.active):hover {
      background: var(--md-state-hover);
      box-shadow: none;
    }
    &.with-icon > a {
      margin-top: -15px;
      margin-bottom: -15px;
      padding-top: 15px;
      padding-bottom: 15px;
    }
  }
  .edit-name {
    font-weight: 600;
  }
  .editor-search {
    input,
    button {
      height: 2.2rem;
    }
  }
  .fatal {
    background: var(--md-error);
    color: var(--md-on-primary);
  }
  .errors {
    border-top-color: var(--md-error);
  }
}

/* html-qualified variants (html is :root, so these can't live inside the wrapper above) */
html.touch:root:root:root {
  .page-popup {
    .script > .menu-item {
      min-height: 60px;
      padding-right: 132px;
    }
    .submenu-buttons {
      height: 60px;
    }
    .submenu-commands > .menu-item {
      min-height: 44px;
      line-height: 44px;
    }
  }
}

html:not(.narrow):root:root:root {
  .aside-menu-item a {
    padding: 12px 0;
  }
}

html.narrow:root:root:root {
  aside {
    border-width: 0;
    box-shadow: var(--md-shadow-1);
  }
  .aside-menu-item a {
    padding: 17px 2px;
    &.active {
      box-shadow: inset 0 -3px 0 var(--md-primary);
    }
  }
  .tab.tab-installed header > * {
    border-bottom-color: var(--fill-2);
  }
}
""",
}


def apply_patches(root: Path):
    for i, (rel, old, new) in enumerate(PATCHES, 1):
        path = root / rel
        text = path.read_text(encoding='utf-8')
        count = text.count(old)
        if count != 1:
            sys.exit(f'[material patch {i}] FAILED: anchor found {count}x (expected 1) in {rel}\n--- anchor ---\n{old}')
        path.write_text(text.replace(old, new), encoding='utf-8')
        print(f'[material patch {i}] OK: {rel}')
    for rel, content in NEW_FILES.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding='utf-8')
        print(f'[new file] OK: {rel}')


if __name__ == '__main__':
    apply_patches(Path(sys.argv[1] if len(sys.argv) > 1 else '.'))

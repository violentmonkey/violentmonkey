#!/usr/bin/env python3
"""
White/compact UI theme for the Violentmonkey fork. Run after apply_patches_addmatch.py from the repo root:

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
    'src/common/ui/style/material.css': r"""/* Clean white theme. Original sizes everywhere except the popup script list on touch devices.
 * Accent colour is used for text, icons, toggles and checkboxes only, never for backgrounds.
 * Tokens at :root:root; component rules under :root:root:root so they beat SFC/popup/options sheets. */

:root:root {
  accent-color: var(--md-primary);
  --md-primary: #8400ff;
  --md-state-hover: rgba(0, 0, 0, .06);
  --md-state-press: rgba(0, 0, 0, .12);
  --md-shadow-card: 0 1px 3px rgba(0, 0, 0, .16), 0 1px 2px rgba(0, 0, 0, .08);
  --md-shadow-menu: 0 2px 6px rgba(0, 0, 0, .18), 0 6px 16px rgba(0, 0, 0, .14);
  --vm-card-head: var(--fill-0-5);
  --focus-border-color: var(--md-primary);
}

@media (prefers-color-scheme: dark) {
  :root:root {
    --md-primary: #c9a7ff;
    --md-state-hover: rgba(255, 255, 255, .08);
    --md-state-press: rgba(255, 255, 255, .14);
    --md-shadow-card: 0 1px 3px rgba(0, 0, 0, .6);
    --md-shadow-menu: 0 2px 6px rgba(0, 0, 0, .6), 0 6px 16px rgba(0, 0, 0, .5);
  }
}

a {
  color: var(--md-primary);
}

:root:root:root {
  /* ---------- shared controls: shape only, original sizes ---------- */
  input[type=text],
  input[type=url],
  input[type=search],
  input[type=number],
  input[type=password],
  select,
  textarea {
    border-radius: 10px;
    padding-left: .5em;
    padding-right: .5em;
    &:focus {
      border-color: var(--md-primary);
    }
  }
  button:not(.btn-ghost) {
    border-radius: 12px;
  }
  .btn-ghost {
    border-radius: 10px;
    &:focus,
    &:focus-within,
    &:hover {
      border-color: transparent;
      background: var(--md-state-hover);
    }
    &:active {
      background: var(--md-state-press);
    }
    &.active {
      border-color: transparent;
      background: var(--md-state-press);
      color: var(--md-primary);
    }
  }
  fieldset {
    border-radius: 12px;
  }
  .modal-content {
    border-radius: 0 0 16px 16px;
    box-shadow: var(--md-shadow-menu);
  }
  .vl-dropdown-menu {
    border-radius: 12px;
    border-color: var(--fill-2);
    box-shadow: var(--md-shadow-menu);
  }
  body .vl-tooltip-content {
    border-radius: 8px;
  }
  .vm-toast {
    border-radius: 0 0 12px 12px;
  }
  .add-match-note {
    border-radius: 10px;
  }

  /* ---------- popup ---------- */
  .page-popup {
    .menu-area {
      &:hover,
      &:focus {
        background: var(--md-state-hover);
        color: inherit;
      }
      &:active {
        background: var(--md-state-press);
      }
    }
    .menu-group {
      color: var(--md-primary);
      font-weight: 600;
    }
    .menu.expand > .menu-group {
      position: sticky;
      top: 0;
      z-index: 2;
      background: var(--bg);
    }
    &[data-is-applied="true"] .menu-buttons > .menu-area:first-of-type {
      color: var(--md-primary);
    }
    .script:not(.disabled) > .menu-item > .icon {
      color: var(--md-primary);
    }
    .script.disabled > .menu-item > .icon {
      color: var(--fill-6);
    }
    .submenu-button {
      &:hover,
      &:focus {
        background: var(--md-state-press);
        color: inherit;
      }
    }
    .menu-item:hover + .submenu-buttons .submenu-button:not(:focus):not(:hover) {
      background: transparent;
    }
  }

  .extras-menu {
    border-radius: 12px;
    border-color: var(--fill-2);
    box-shadow: var(--md-shadow-menu);
    overflow: hidden;
    > * {
      &:hover,
      &:focus {
        background: var(--md-state-hover);
        color: inherit;
      }
      &:active {
        background: var(--md-state-press);
      }
    }
  }

  /* ---------- dashboard: one white header, rounded shadowed cards ---------- */
  aside {
    border-color: var(--fill-2);
    background: var(--bg);
  }
  .aside-menu-item a.active {
    color: var(--md-primary);
  }
  .tab.tab-installed {
    header {
      border-bottom-color: var(--fill-2);
      background: var(--bg);
      .filtered,
      .btn-group {
        border-right-color: var(--fill-2);
      }
    }
    .filter-search input {
      padding-left: .75rem;
      border-radius: 20px;
    }
  }
  .scripts .script {
    border-color: var(--fill-2);
    border-radius: 14px;
    box-shadow: var(--md-shadow-card);
    &:hover {
      border-color: var(--fill-4);
    }
    &.focused,
    &.focused:focus {
      box-shadow: 1px 2px 9px var(--fill-7);
    }
    .script-buttons {
      color: var(--fill-11);
    }
  }
  .scripts[data-table] .script {
    border-radius: 0;
    box-shadow: none;
  }

  /* ---------- settings: bordered rounded cards ---------- */
  .tab-settings {
    section {
      margin: 0 0 14px;
      padding: 12px 16px 14px;
      border: 1px solid var(--fill-3);
      border-radius: 16px;
      background: var(--bg);
      > h3 {
        margin: -12px -16px 12px !important;
        border-radius: 15px 15px 0 0;
        padding: 0 16px;
        border: 0;
        border-bottom: 1px solid var(--fill-3);
        background: var(--hbg, var(--vm-card-head));
        color: var(--md-primary);
        font-size: 1rem;
        font-weight: 600;
        line-height: 2.6;
      }
    }
    details > summary.h3 {
      margin: 0 0 14px !important;
      padding: 0 16px;
      border: 1px solid var(--fill-3);
      border-radius: 16px;
      background: var(--vm-card-head);
      line-height: 2.6;
      > * {
        margin: 0;
        color: var(--md-primary);
        font-size: 1rem;
        font-weight: 600;
      }
    }
  }
}

/* ---------- popup script list: larger tap targets on touch devices only ---------- */
html.touch:root:root:root {
  .page-popup {
    .submenu {
      padding-bottom: 6px;
      > .script {
        margin: 2px 6px;
        border-radius: 12px;
      }
    }
    .script {
      > .menu-item {
        min-height: 46px;
        padding: 4px 130px 4px 0;
        border-radius: 12px;
      }
      .script-icon {
        left: 12px;
        width: 22px;
        height: 22px;
        max-width: 22px;
        max-height: 22px;
        margin: 0;
        object-fit: contain;
        & + .icon {
          flex: 0 0 30px;
          width: 30px;
          height: 20px;
          margin-left: 42px;
          margin-right: 10px;
        }
      }
      .script-name {
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
    }
    .submenu-buttons {
      right: 4px;
      align-items: center;
      height: 46px;
      padding-left: 4px;
      background: transparent;
      &::before {
        content: '';
        flex: 0 0 1px;
        height: 24px;
        margin-right: 4px;
        background: var(--fill-3);
      }
    }
    .submenu-button {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 38px;
      height: 38px;
      padding: 0;
      border-radius: 50%;
      background: transparent;
      .icon {
        width: 20px;
        height: 20px;
      }
    }
    .submenu-commands {
      padding-left: 78px;
      summary {
        width: 78px;
        padding-left: 42px;
      }
      > .menu-item {
        min-height: 36px;
        line-height: 36px;
      }
    }
    .upd[title] {
      padding-left: 82px;
    }
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

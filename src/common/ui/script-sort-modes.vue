<template>
  <select v-model="model">
    <option
      v-for="({ text, title, reversed }, name) in items || getSortModes()" :key="name"
      v-text="text"
      :title="title"
      :value="name"
      :class="{ reversed, current: name === model }"
    />
  </select>
</template>

<script>
import { i18n } from '@/common';
import { INFERRED, kSortAlpha, kSortAuthor, kSortExec, kSortSize, kSortUpdate, kSortVisit } from '@/common/consts';
import { getSortCollator } from './util';

/** @type {{ [key:string]: SortMode }} */
let items;
const popup = location.pathname.startsWith('/popup');

export const getSortModes = (icons) => {
  const collator = getSortCollator();
  const cmpName = popup ?
    /** @param {UIScriptPopup} a
     * @param {UIScriptPopup} b */
    (a, b) => collator.compare(a.name, b.name) :
    /** @param {UIScript} a
     * @param {UIScript} b */
    (a, b) => collator.compare(a.$cache.name, b.$cache.name);
  const cmpPos = (a, b) => a.props.position - b.props.position;
  items = {};
  for (const [key, text, compare, title] of [
    [kSortExec, i18n('filterExecutionOrder'), popup && cmpPos],
    [kSortAlpha, i18n('filterAlphabeticalOrder'), cmpName],
    [kSortAuthor, i18n('labelAuthor').replace(/[\s:꞉︓﹕：]+/u, '').toLowerCase(),
      /** @param {UIScript} a
       * @param {UIScript} b */
      (a, b) => collator.compare(a.meta.author || '', b.meta.author || '') || cmpName(a, b),
    ],
    [kSortUpdate, i18n('filterLastUpdateOrder'),
      /** @param {UIScript} a
       * @param {UIScript} b */
      (a, b) => (+b.props.lastUpdated || 0) - (+a.props.lastUpdated || 0),
    ],
    // scripts in the popup have the same visit time
    [!popup && kSortVisit, i18n('filterLastVisitOrder'),
      /** @param {UIScript} a
       * @param {UIScript} b */
      (a, b) => (b[INFERRED].visit || 0) - (a[INFERRED].visit || 0),
      i18n('filterLastVisitOrderTooltip'),
    ],
    [kSortSize, i18n('filterSize'),
      popup ?
        /** @param {UIScriptPopup} a
         * @param {UIScriptPopup} b */
        (a, b) => a.sizeNum - b.sizeNum :
        /** @param {UIScript} a
         * @param {UIScript} b */
        (a, b) => a.$cache.sizeNum - b.$cache.sizeNum,
    ],
  ]) {
    if (!key) continue;
    items[key] = {
      text,
      title,
      icon: icons?.[key][0],
      compare,
    };
    items[key + '-'] = /**@namespace SortMode*/{
      reversed: true,
      text: text + ' ⥯',
      title: title,
      icon: icons?.[key][1],
      compare: compare || ((a, b) => a.props.position - b.props.position),
    };
  }
  return items;
};
</script>

<script setup>
const model = defineModel();
</script>

<style>
option.reversed {
  color: var(--fill-11);
}
option.current {
  font-weight: bold;
}
</style>

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
import { INFERRED } from '@/common/consts';
import IconAlpha from '~icons/mdi/sort-alphabetical-ascending';
import IconAlphaDown from '~icons/mdi/sort-alphabetical-descending';
import IconSort from '~icons/mdi/sort-ascending';
import IconCalendar from '~icons/mdi/sort-calendar-ascending';
import IconCalendarDown from '~icons/mdi/sort-calendar-descending';
import IconClock from '~icons/mdi/sort-clock-ascending-outline';
import IconClockDown from '~icons/mdi/sort-clock-descending-outline';
import IconSortDown from '~icons/mdi/sort-descending';
import IconSmallBig from '~icons/tabler/sort-ascending-small-big';
import IconBigSmall from '~icons/tabler/sort-descending-small-big';
import IconUserDown from '~icons/tdesign/user-arrow-down';
import IconUser from '~icons/tdesign/user-arrow-up';
import { getSortCollator } from './util';

/** @type {{ [key:string]: SortMode }} */
let items;
const popup = location.pathname.startsWith('/popup');

export const getSortModes = () => {
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
  for (const [key, text, icon, iconRev, compare, title] of [
    ['exec', i18n('filterExecutionOrder'), IconSort, IconSortDown, popup && cmpPos],
    ['alpha', i18n('filterAlphabeticalOrder'), IconAlpha, IconAlphaDown, cmpName],
    ['author', i18n('labelAuthor').replace(/[\s:꞉︓﹕：]+/u, '').toLowerCase(),
      IconUser, IconUserDown,
      /** @param {UIScript} a
       * @param {UIScript} b */
      (a, b) => collator.compare(a.meta.author || '', b.meta.author || '') || cmpName(a, b),
    ],
    ['update', i18n('filterLastUpdateOrder'), IconClock, IconClockDown,
      /** @param {UIScript} a
       * @param {UIScript} b */
      (a, b) => (+b.props.lastUpdated || 0) - (+a.props.lastUpdated || 0),
    ],
    // scripts in the popup have the same visit time
    [!popup && 'visit', i18n('filterLastVisitOrder'), IconCalendar, IconCalendarDown,
      /** @param {UIScript} a
       * @param {UIScript} b */
      (a, b) => (b[INFERRED].visit || 0) - (a[INFERRED].visit || 0),
      i18n('filterLastVisitOrderTooltip'),
    ],
    ['size', i18n('filterSize'), IconSmallBig, IconBigSmall,
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
      icon,
      compare,
    };
    items[key + '-'] = /**@namespace SortMode*/{
      reversed: true,
      text: text + ' ⥯',
      title: title,
      icon: iconRev,
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

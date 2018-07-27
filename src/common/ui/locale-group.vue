<template>
  <span>
    {{parts[0]}}
    <slot></slot>
    {{parts[1]}}
  </span>
</template>

<script>
import { i18n } from '#/common';

const SEP = '￥￥';

export default {
  props: ['i18nKey'],
  computed: {
    parts() {
      return i18n(this.i18nKey, [SEP]).split(SEP);
    },
  },
};
</script>

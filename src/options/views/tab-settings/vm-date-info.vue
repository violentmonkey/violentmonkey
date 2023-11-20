<template>
  <tooltip :content="DATE_HELP" placement="left" style="vertical-align: middle">
    <a :href="DATE_HELP_URL" target="_blank">
      <icon name="info"/>
    </a>
  </tooltip>
</template>

<script>
import { i18n } from '@/common';
import { DATE_FMT } from '@/common/date';
const DATE_HELP = i18n('msgDateFormatInfo', Object.keys(DATE_FMT).join(', '));
const DATE_HELP_URL = 'https://momentjs.com/docs/#/displaying/format/';
</script>

<script setup>
import Tooltip from 'vueleton/lib/tooltip';
import Icon from '@/common/ui/icon';
</script>

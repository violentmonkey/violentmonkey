<template>
  <section>
    <h3 v-text="i18n('labelBlacklist')"/>
    <p>
      <a href="https://violentmonkey.github.io/posts/smart-rules-for-blacklist/#blacklist-patterns"
         v-text="i18n('learnBlacklist')" target="_blank" rel="noopener noreferrer"/>
    </p>
    <VmBlacklistBody :name="BLACKLIST" :desc="i18n('descBlacklist')"/>
    <VmBlacklistBody :name="BLACKLIST_NET" :desc="i18n('descBlacklistNet')"/>
  </section>
</template>

<script>
import { BLACKLIST, BLACKLIST_NET } from '@/common/consts';
</script>

<script setup>
import VmBlacklistBody from './vm-blacklist-body';
</script>

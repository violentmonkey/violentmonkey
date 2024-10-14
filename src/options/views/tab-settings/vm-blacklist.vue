<template>
  <section>
    <h3 v-text="i18n('labelBlacklist')"/>
    <p>
      <a :href="VM_HOME + 'posts/smart-rules-for-blacklist/#blacklist-patterns'"
         v-text="i18n('learnBlacklist')" v-bind="EXTERNAL_LINK_PROPS"/>
    </p>
    <VmBlacklistBody :name="BLACKLIST" :desc="i18n('descBlacklist')"/>
    <VmBlacklistBody :name="BLACKLIST_NET" :desc="i18n('descBlacklistNet')"/>
  </section>
</template>

<script>
import { BLACKLIST, BLACKLIST_NET, VM_HOME } from '@/common/consts';
import { EXTERNAL_LINK_PROPS } from '@/common/ui';
</script>

<script setup>
import VmBlacklistBody from './vm-blacklist-body';
</script>

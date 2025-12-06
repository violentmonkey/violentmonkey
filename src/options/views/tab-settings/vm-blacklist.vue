<template>
  <section>
    <h3 v-text="i18n('labelBlocklist')"/>
    <p>
      <a :href="VM_HOME + 'posts/smart-rules-for-blocklist/#blocklist-patterns'"
         v-text="i18n('learnBlocklist')" v-bind="EXTERNAL_LINK_PROPS"/>
    </p>
    <VmBlocklistBody :name="BLOCKLIST" :desc="i18n('descBlocklist')"/>
    <VmBlocklistBody :name="BLOCKLIST_NET" :desc="i18n('descBlocklistNet')"/>
  </section>
</template>

<script>
import { BLOCKLIST, BLOCKLIST_NET, VM_HOME } from '@/common/consts';
import { EXTERNAL_LINK_PROPS } from '@/common/ui';
</script>

<script setup>
import VmBlocklistBody from './vm-blocklist-body';
</script>

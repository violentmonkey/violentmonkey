<template>
  <section>
    <h3 v-text="i18n('labelBlacklist')"></h3>
    <p>
      {{i18n('descBlacklist')}}
      <a href="https://violentmonkey.github.io/posts/smart-rules-for-blacklist/#blacklist-patterns" target="_blank" rel="noopener noreferrer" v-text="i18n('learnBlacklist')"></a>
    </p>
    <div class="flex flex-wrap">
      <setting-text name="blacklist" class="flex-1" @save="onSave" @bgError="errors = $event"/>
      <ol v-if="errors" class="text-red">
        <li v-for="e in errors" :key="e" v-text="e"/>
      </ol>
    </div>
  </section>
</template>

<script>
import { sendCmdDirectly } from '@/common';
import { BLACKLIST_ERRORS } from '@/common/consts';
import { showMessage } from '@/common/ui';
import SettingText from '@/common/ui/setting-text';

export default {
  components: {
    SettingText,
  },
  data() {
    return {
      errors: null,
    };
  },
  methods: {
    onSave() {
      showMessage({ text: this.i18n('msgSavedBlacklist') });
    },
  },
  async mounted() {
    this.errors = await sendCmdDirectly('Storage', ['base', 'getOne', BLACKLIST_ERRORS]);
  },
};
</script>

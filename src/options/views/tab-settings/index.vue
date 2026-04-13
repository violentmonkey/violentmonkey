<template>
  <div ref="$el" class="tab-settings">
    <h1 v-text="i18n('labelSettings')"></h1>
    <div class="settings-grid">
      <section class="mb-1c">
        <h3 v-text="i18n('optionPopup')"/>
        <settings-popup/>
      </section>
      <section class="mb-1c">
        <h3 v-text="i18n('optionUpdate')"/>
        <div class="ml-2c flex flex-col">
          <label>
            <locale-group i18n-key="labelAutoUpdate">
              <input v-model="settings.autoUpdate" type="number" min=0 max=365 step=1/>
            </locale-group>
          </label>
          <setting-check :name="kUpdateEnabledScriptsOnly"
                         :label="i18n('labelEnabledScriptsOnly')" />
        </div>
        <div class="ml-2c flex flex-col">
          <label>
            <span v-text="i18n('labelInjectionMode')"></span>
            <select v-for="opt in ['defaultInjectInto']" v-model="settings[opt]" :key="opt">
              <option v-for="(_, mode) in items[opt]" :key="mode" v-text="mode" />
            </select>
            <a class="ml-1" :href="VM_HOME + 'posts/inject-into-context/'" v-bind="EXTERNAL_LINK_PROPS" v-text="i18n('learnInjectionMode')"/>
          </label>
          <tooltip :content="i18n('labelXhrInjectHint')">
            <setting-check name="xhrInject">
              <locale-group i18n-key="labelXhrInject">
                <code>page</code>
              </locale-group> <ruby v-text="i18n('labelXhrInjectNote')"/>
            </setting-check>
          </tooltip>
          <label>
            <setting-check name="ffInject"/>
            <tooltip :content="i18n('labelFastFirefoxInjectHint')">
              <locale-group i18n-key="labelFastFirefoxInject">
                <code>page</code>
              </locale-group>
            </tooltip>
          </label>
        </div>
        <div class="flex flex-col">
          <locale-group i18n-key="labelExposeStatus">
            <setting-check v-for="([key, host]) in expose" :key="host"
                           :name="`expose.${key}`" class="ml-2 mr-1c">
              <span v-text="host" />
              <a :href="`https://${host}`" v-bind="EXTERNAL_LINK_PROPS">&nearr;</a>
            </setting-check>
          </locale-group>
        </div>
      </section>
      <vm-sync></vm-sync>
      <vm-licensing></vm-licensing>
    </div>
  </div>
</template>

<script>
import { i18n } from '@/common';
import { keyboardService } from '@/common/keyboard';
import { kUpdateEnabledScriptsOnly } from '@/common/options-defaults';
import { focusMe, getActiveElement } from '@/common/ui';
import { hookSettingsForUI } from '@/common/ui/util';
const items = {
  autoUpdate: value => Math.max(0, Math.min(365, +value || 0)),
};
</script>

<script setup>
import { onActivated, onDeactivated, reactive, ref, watch } from 'vue';
import SettingCheck from '@/common/ui/setting-check';
import LocaleGroup from '@/common/ui/locale-group';
import SettingsPopup from '@/common/ui/settings-popup.vue';
import VmSync from './vm-sync';
import VmLicensing from './vm-licensing';

const $el = ref();
const settings = reactive({});
const ctrlS = () => getActiveElement().dispatchEvent(new Event('ctrl-s'));
let revokers;

onActivated(() => {
  focusMe($el.value);
  revokers = [
    keyboardService.register('ctrlcmd-s', ctrlS, { condition: 'inputFocus' }),
    ...hookSettingsForUI(items, settings, watch, 50),
  ];
});

onDeactivated(() => {
  revokers.forEach(r => r());
  revokers = null;
});
</script>

<style>
.tab-settings {
  overflow-y: auto;
  padding: 0;
  
  input[type="number"] {
    width: 3.5em;
    padding-left: .25em;
  }
  
  h1 {
    margin: 0 0 1.5rem 0;
    padding: 1rem;
  }
  
  .settings-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
    gap: 2rem;
    padding: 0 1rem 1rem 1rem;
    
    > section {
      padding: 1rem;
      border-radius: 6px;
      background: var(--bg-2);
      
      h3 {
        margin-top: 0;
        margin-bottom: 1rem;
        font-size: 1.1rem;
        border-bottom: 2px solid var(--fill-4);
        padding-bottom: 0.5rem;
      }
    }
  }
  
  ruby {
    color: var(--fill-8);
  }
  
  .icon {
    width: 16px;
    height: 16px;
    fill: var(--fg);
  }
}
</style>

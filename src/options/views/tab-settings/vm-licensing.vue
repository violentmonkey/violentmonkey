<template>
  <section class="mb-1c">
    <h3 v-text="i18n('labelLicensing')"></h3>
    <div class="ml-2c flex flex-col">
      <label>
        <locale-group i18n-key="labelLicenseEmail">
          <input
            v-model="settings.licenseEmail"
            type="email"
            placeholder="user@example.com"
            class="w-full"
          />
        </locale-group>
      </label>
      <label>
        <locale-group i18n-key="labelLicenseKey">
          <input
            v-model="settings.licenseKey"
            type="password"
            placeholder="••••••••••••••••"
            class="w-full"
          />
        </locale-group>
      </label>
      <label>
        <locale-group i18n-key="Script URL:">
          <input
            v-model="settings.scriptExecutionUrl"
            type="url"
            placeholder="https://example.com/dashboard"
            class="w-full"
          />
        </locale-group>
      </label>
      <button
        type="button"
        @click="saveLicenseInformation"
        class="mt-1c"
        :disabled="licenseStatus.loading || !settings.licenseEmail || !settings.licenseKey">
        {{ i18n('Save License Information') }}
      </button>
      <div v-if="licenseStatus.message" :class="['status-message', licenseStatus.valid ? 'valid' : 'invalid']">
        {{ licenseStatus.message }}
      </div>
    </div>
  </section>
</template>

<script setup>
import { i18n, sendCmdDirectly } from '@/common';
import options from '@/common/options';
import { reactive, watch } from 'vue';
import LocaleGroup from '@/common/ui/locale-group';

const settings = reactive({
  licenseEmail: '',
  licenseKey: '',
  scriptExecutionUrl: '',
});

const licenseStatus = reactive({
  valid: false,
  message: '',
  loading: false,
});

// Initialize settings from stored options
Object.assign(settings, {
  licenseEmail: options.get('licenseEmail') || '',
  licenseKey: options.get('licenseKey') || '',
  scriptExecutionUrl: options.get('scriptExecutionUrl') || '',
});

// Watch for changes and save them
watch(() => settings.licenseEmail, (newVal) => {
  options.set('licenseEmail', newVal);
});

watch(() => settings.licenseKey, (newVal) => {
  options.set('licenseKey', newVal);
});

watch(() => settings.scriptExecutionUrl, (newVal) => {
  options.set('scriptExecutionUrl', newVal);
});

function normalizeMatchUrl(input) {
  try {
    return `${new URL(input.trim()).origin}/*`;
  } catch {
    return '';
  }
}

const saveLicenseInformation = async () => {
  const email = settings.licenseEmail;
  const key = settings.licenseKey;
  const matchUrl = normalizeMatchUrl(settings.scriptExecutionUrl);
  
  if (!email || !key) {
    licenseStatus.valid = false;
    licenseStatus.message = 'Email and license key are required';
    return;
  }

  if (!matchUrl) {
    licenseStatus.valid = false;
    licenseStatus.message = 'A valid script execution URL is required';
    return;
  }
  if (settings.scriptExecutionUrl !== matchUrl) {
    settings.scriptExecutionUrl = matchUrl;
  }
  
  try {
    licenseStatus.loading = true;
    licenseStatus.message = 'Saving license information and syncing scripts...';
    
    const result = await sendCmdDirectly('SyncLicensedScripts', {
      email,
      licenseKey: key,
      matchUrl,
    });
    
    if (result.success) {
      licenseStatus.valid = true;
      licenseStatus.message = `License saved. Checked ${result.scriptCount || 0} licensed scripts, updated ${result.updatedCount || 0}, enforced URL rules on ${result.matchCount || 0}.`;
    } else {
      licenseStatus.valid = false;
      licenseStatus.message = result.message || 'Failed to save license information';
    }
  } catch (error) {
    licenseStatus.valid = false;
    licenseStatus.message = `Error: ${error.message || 'Failed to save license information'}`;
  } finally {
    licenseStatus.loading = false;
  }
};
</script>

<style scoped>
.status-message {
  margin-top: 0.5rem;
  padding: 0.5rem;
  border-radius: 4px;
  font-weight: 500;
}

.status-message.valid {
  background-color: #d4edda;
  color: #155724;
  border: 1px solid #c3e6cb;
}

.status-message.invalid {
  background-color: #f8d7da;
  color: #721c24;
  border: 1px solid #f5c6cb;
}

label {
  display: block;
  margin-bottom: 1rem;
}

input {
  border: 1px solid #ccc;
  border-radius: 4px;
  padding: 0.5rem;
  font-size: 1rem;
}

input:focus {
  outline: none;
  border-color: #0066cc;
  box-shadow: 0 0 0 3px rgba(0, 102, 204, 0.1);
}
</style>

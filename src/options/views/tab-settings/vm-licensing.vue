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
        @click="validateAndFetchLicensedScripts" 
        class="mt-1c"
        :disabled="!settings.licenseEmail || !settings.licenseKey">
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
import { reactive, watch, ref } from 'vue';
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

const isUpdatingMatches = ref(false);

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

const validateAndFetchLicensedScripts = async () => {
  const email = settings.licenseEmail;
  const key = settings.licenseKey;
  
  if (!email || !key) {
    licenseStatus.valid = false;
    licenseStatus.message = 'Email and license key are required';
    return;
  }
  
  try {
    licenseStatus.loading = true;
    licenseStatus.message = 'Validating license...';
    
    // Validate license and fetch scripts from the API
    const result = await sendCmdDirectly('ValidateAndFetchLicensedScripts', {
      email,
      licenseKey: key,
    });
    
    if (result.valid) {
      licenseStatus.valid = true;
      licenseStatus.message = `License valid! ${result.scriptCount || 0} scripts available. Click "Update Script URLs" to enforce URL restrictions.`;
      
    } else {
      licenseStatus.valid = false;
      licenseStatus.message = result.message || 'Invalid license';
    }
  } catch (error) {
    licenseStatus.valid = false;
    licenseStatus.message = `Error: ${error.message || 'Failed to validate license'}`;
  } finally {
    licenseStatus.loading = false;
  }

  //ensure all scripts are limited to the site URL
   await updateAllScriptMatches();
};

const updateAllScriptMatches = async () => {
  const matchUrl = settings.scriptExecutionUrl;
  
  if (!matchUrl) {
    licenseStatus.valid = false;
    licenseStatus.message = 'Script execution URL is required';
    return;
  }
  
  try {
    isUpdatingMatches.value = true;
    licenseStatus.message = 'Updating script URLs...';
    
    // Get licensed scripts from options
    const licensedScripts = options.get('licensedScripts') || [];
    
    if (licensedScripts.length === 0) {
      licenseStatus.message = 'No licensed scripts found';
      return;
    }
    
    // Update @match patterns for each licensed script
    // Note: In a real implementation, you'd get the script IDs from the extension
    // For now, we'll call a command that handles this
    const result = await sendCmdDirectly('UpdateAllScriptMatches', {
      matchUrl,
      licensedScriptNames: licensedScripts.map(s => s.scriptName),
    });
    
    if (result.success) {
      licenseStatus.valid = true;
      licenseStatus.message = `Updated ${result.count || 0} scripts to run on: ${matchUrl}`;
    } else {
      licenseStatus.valid = false;
      licenseStatus.message = result.message || 'Failed to update scripts';
    }
  } catch (error) {
    licenseStatus.valid = false;
    licenseStatus.message = `Error: ${error.message || 'Failed to update scripts'}`;
  } finally {
    isUpdatingMatches.value = false;
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

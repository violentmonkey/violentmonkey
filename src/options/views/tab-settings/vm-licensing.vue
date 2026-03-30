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
      <div v-if="licenseStatus.message" :class="['status-message', licenseStatus.valid ? 'valid' : 'invalid']">
        {{ licenseStatus.message }}
      </div>
    </div>
  </section>
</template>

<script setup>
import { i18n } from '@/common';
import options from '@/common/options';
import { reactive, watch } from 'vue';
import LocaleGroup from '@/common/ui/locale-group';

const settings = reactive({
  licenseEmail: '',
  licenseKey: '',
});

const licenseStatus = reactive({
  valid: false,
  message: '',
});

// Initialize settings from stored options
Object.assign(settings, {
  licenseEmail: options.get('licenseEmail') || '',
  licenseKey: options.get('licenseKey') || '',
});

// Watch for changes and save them
watch(() => settings.licenseEmail, (newVal) => {
  options.set('licenseEmail', newVal);
  validateLicense();
});

watch(() => settings.licenseKey, (newVal) => {
  options.set('licenseKey', newVal);
  validateLicense();
});

const validateLicense = () => {
  const email = settings.licenseEmail;
  const key = settings.licenseKey;
  
  if (!email || !key) {
    licenseStatus.valid = false;
    licenseStatus.message = '';
    return;
  }
  
  // TODO: Replace with actual license validation logic
  // This is a placeholder for validation
  if (email && key && key.length >= 16) {
    licenseStatus.valid = true;
    licenseStatus.message = i18n('labelLicenseValid');
  } else {
    licenseStatus.valid = false;
    licenseStatus.message = i18n('labelLicenseInvalid');
  }
};

// Validate on mount if values exist
validateLicense();
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

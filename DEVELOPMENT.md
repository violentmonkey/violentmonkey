# Development

## Icons

All icons from [Iconify's MDI set](https://icon-sets.iconify.design/mdi/) can be used with [unplugin-icons](https://github.com/unplugin/unplugin-icons).

Icons follow the pattern: `~icons/mdi/{icon-name}` where `{icon-name}` matches the MDI icon name (e.g., `mdi/home`, `mdi/account-circle`).

```vue
<script setup>
import IconSync from '~icons/mdi/sync';
</script>

<template>
  <IconSync />
</template>
```

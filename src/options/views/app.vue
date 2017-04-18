<script>
import { store } from '../utils';
import Main from './main';
import Confirm from './confirm';

const components = {
  Main,
  Confirm,
};

export default {
  render(h) {
    // store.route.comp should not change
    const comp = components[store.route.comp];
    return h(comp);
  },
};
</script>

<style src="../style.css"></style>

<script>
import { store } from '../utils';
import Main from './main';
import Confirm from './confirm';

export default {
  render(h) {
    return h({
      '': Main,
      confirm: Confirm,
    }[store.route.path]);
  },
};
</script>

<style src="../style.css"></style>

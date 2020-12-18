import { route } from '#/common/router';
import { isHiDPI } from '#/common/ui/favicon';

export const store = {
  route,
  HiDPI: isHiDPI,
};

import { httpRequested } from './requests';
import { inject, objEncode, getUniqId, sendMessage } from './utils';
import { onNotificationClick, onNotificationClose } from './notification';
import bridge from './content';
import webBridgeObj from './web';

(function main() {
  // Avoid running repeatedly due to new `document.documentElement`
  if (window.VM) return;
  window.VM = 1;

  const badge = {
    number: 0,
    ready: false,
    willSet: false,
  };
  function getBadge() {
    badge.willSet = true;
    setBadge();
  }
  function setBadge() {
    if (badge.ready && badge.willSet) {
      // XXX: only scripts run in top level window are counted
      if (top === window) sendMessage({ cmd: 'SetBadge', data: badge.number });
    }
  }

  // Messages
  browser.runtime.onMessage.addListener((req, src) => {
    const handlers = {
      Command(data) {
        bridge.post({ cmd: 'Command', data });
      },
      GetPopup: bridge.getPopup,
      GetBadge: getBadge,
      HttpRequested: httpRequested,
      UpdateValues(data) {
        bridge.post({ cmd: 'UpdateValues', data });
      },
      NotificationClick: onNotificationClick,
      NotificationClose: onNotificationClose,
    };
    const handle = handlers[req.cmd];
    if (handle) handle(req.data, src);
  });

  function initWeb(webBridge, webId, contentId, props) {
    webBridge.initialize(webId, contentId, props);
    document.addEventListener('DOMContentLoaded', () => {
      webBridge.state = 1;
      webBridge.load();
    }, false);
    webBridge.checkLoad();
  }
  function initBridge() {
    const contentId = getUniqId();
    const webId = getUniqId();
    const args = [
      objEncode(webBridgeObj),
      JSON.stringify(webId),
      JSON.stringify(contentId),
      JSON.stringify(Object.getOwnPropertyNames(window)),
    ];
    inject(`(${initWeb.toString()})(${args.join(',')})`);
    bridge.initialize(contentId, webId);
    sendMessage({ cmd: 'GetInjected', data: location.href })
    .then(data => {
      bridge.forEach(data.scripts, script => {
        bridge.ids.push(script.id);
        if (script.enabled) badge.number += 1;
      });
      bridge.post({ cmd: 'LoadScripts', data });
      badge.ready = true;
      bridge.getPopup();
      setBadge();
    });
  }
  initBridge();
}());

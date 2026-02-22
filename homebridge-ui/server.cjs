const { HomebridgePluginUiServer } = require('@homebridge/plugin-ui-utils');

class UiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    setImmediate(() => {
      this.ready();
    });
  }
}

(() => {
  return new UiServer();
})();

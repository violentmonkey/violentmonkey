const Environment = require('jest-environment-jsdom').default;

module.exports = class CustomTestEnvironment extends Environment {
  async setup() {
    await super.setup();
    this.global.MessageChannel ||= MessageChannel;
    this.global.MessagePort ||= MessagePort;
    this.global.TextEncoder ||= TextEncoder;
    this.global.TextDecoder ||= TextDecoder;
  }
};

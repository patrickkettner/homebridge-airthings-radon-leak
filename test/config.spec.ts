import { expect } from 'chai';
import sinon from 'sinon';
import { parseConfig } from '../src/config.js';
import { Logger } from 'homebridge';

describe('Config', () => {
  let mockLogger: sinon.SinonStubbedInstance<Logger>;

  beforeEach(() => {
    mockLogger = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
      debug: sinon.stub(),
      log: sinon.stub(),
    } as unknown as sinon.SinonStubbedInstance<Logger>;
  });

  it('populates default values when passed empty config', () => {
    const config = parseConfig({}, mockLogger);
    expect(config.platform).to.equal('AirthingsHub');
    expect(config.clientId).to.equal('');
    expect(config.clientSecret).to.equal('');
    expect(config.radonThreshold).to.equal(150);
    expect(config.radonUnit).to.equal('Bq/m3');
    expect(config.sensors).to.deep.equal(['radon', 'battery']);
    expect(config.enableEveCustomCharacteristics).to.be.false;
    expect(config.orphanGracePeriodDays).to.equal(14);
    expect(config.ignoredDevices).to.deep.equal([]);
    expect(config.includedDevices).to.deep.equal([]);
    expect(config.debugMode).to.be.false;
    expect(mockLogger.error.calledWithMatch(sinon.match(/Missing Client ID/))).to.be.true;
  });

  it('preserves provided valid values and applies pCi/L', () => {
    const config = parseConfig({
      platform: 'CustomPlatform',
      clientId: 'my-client',
      clientSecret: 'my-secret',
      radonThreshold: 100,
      radonUnit: 'pCi/L',
      sensors: ['radon', 'co2', 'temp'],
      enableEveCustomCharacteristics: true,
      orphanGracePeriodDays: 30,
      ignoredDevices: ['device-1'],
      includedDevices: ['device-2'],
      debugMode: true,
    }, mockLogger);

    expect(config.platform).to.equal('CustomPlatform');
    expect(config.clientId).to.equal('my-client');
    expect(config.clientSecret).to.equal('my-secret');
    expect(config.radonThreshold).to.equal(100);
    expect(config.radonUnit).to.equal('pCi/L');
    expect(config.sensors).to.deep.equal(['radon', 'co2', 'temp']);
    expect(config.enableEveCustomCharacteristics).to.be.true;
    expect(config.orphanGracePeriodDays).to.equal(30);
    expect(config.ignoredDevices).to.deep.equal(['device-1']);
    expect(config.includedDevices).to.deep.equal(['device-2']);
    expect(config.debugMode).to.be.true;
    expect(mockLogger.error.called).to.be.false;
  });
});

import { expect } from 'chai';
import sinon from 'sinon';
import { AirthingsHubPlatform } from '../src/platform.js';
import { createMockHomebridge, MockHomebridge } from './helpers/homebridge.mock.js';
import { AirthingsApiClient } from '../src/api.js';
import { AirthingsHubAccessory } from '../src/accessory.js';

describe('AirthingsHubPlatform', () => {
  let mockHb: MockHomebridge;
  let platform: AirthingsHubPlatform;
  let getDevicesStub: sinon.SinonStub;
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    mockHb = createMockHomebridge();
    // Prevent accessory auto-init from crashing before we inject our stubs
    getDevicesStub = sinon.stub(AirthingsApiClient.prototype, 'getDevices').resolves([]);
  });

  afterEach(() => {
    clock.restore();
    sinon.restore();
  });

  function createPlatform(config: Record<string, any> = { clientId: 'client', clientSecret: 'secret' }) {
    return new AirthingsHubPlatform(mockHb.logger, config, mockHb.api as any);
  }

  it('bails out of initialization if client ID or secret is missing', () => {
    platform = createPlatform({ clientId: '' });
    expect(mockHb.api.on.called).to.be.false;
  });

  it('registers didFinishLaunching event', () => {
    platform = createPlatform();
    expect(mockHb.api.on.calledWith('didFinishLaunching' as any)).to.be.true;
  });

  it('clears all active poller intervals on shutdown', async () => {
    platform = createPlatform({ clientId: 't', clientSecret: 't', debugMode: true });
    getDevicesStub.resolves([
      { id: 'dev123', location: { name: 'Living Room' }, deviceType: 'WAVE', sensors: [] }
    ]);

    const fn = mockHb.api.on.getCall(0).args[1];
    fn();
    await clock.tickAsync(5);

    const stopPollingSpy = sinon.spy(AirthingsHubAccessory.prototype, 'stopPolling');

    const shutdownFn = mockHb.api.on.getCall(1).args[1];
    shutdownFn();

    expect(stopPollingSpy.calledOnce).to.be.true;
    expect(mockHb.logger.info.calledWithMatch(sinon.match(/Terminating all active polling loops for shutdown/))).to.be.true;
  });

  it('restores cached accessories via configureAccessory', () => {
    platform = createPlatform({ clientId: 't', clientSecret: 't', debugMode: true });
    const acc = mockHb.api.platformAccessory('Test Acc', 'uuid-123');
    platform.configureAccessory(acc);
    expect(platform.accessories).to.include(acc);
    expect(mockHb.logger.info.calledWithMatch(/Loading accessory from cache/)).to.be.true;
  });

  describe('Device Discovery', () => {
    it('catches and logs errors during discovery', async () => {
      platform = createPlatform();
      getDevicesStub.rejects(new Error('Network Down'));

      // Trigger the listener to cover the catch block
      const fn = mockHb.api.on.getCall(0).args[1];
      fn(); // Returns void, kicks off promise

      // Yield to let the promise chain resolve using the fake clock
      await clock.tickAsync(5);

      expect(mockHb.logger.error.calledWithMatch(/Network Down/)).to.be.true;
    });

    it('catches and logs non-Error objects during discovery', async () => {
      platform = createPlatform();
      getDevicesStub.returns(Promise.reject('String Error'));

      const fn = mockHb.api.on.getCall(0).args[1];
      fn();

      await clock.tickAsync(5);

      // Verify String(err) fallback handles the "String Error" string appropriately
      expect(mockHb.logger.error.calledWithMatch(/String Error/)).to.be.true;
    });

    it('removes all orphaned accessories if API returns empty devices array', async () => {
      platform = createPlatform({ clientId: 't', clientSecret: 't', orphanGracePeriodDays: 0 });
      getDevicesStub.resolves([{ id: 'test', deviceType: 'WAVE', sensors: [] }]);

      // Discover once to create the wrapper
      await platform.discoverDevices();

      const stopPollingSpy = sinon.spy(AirthingsHubAccessory.prototype, 'stopPolling');

      // Force it to be deeply orphaned on next tick
      platform.accessories[0].context.orphanedSince = -100;
      getDevicesStub.resolves([]);

      await platform.discoverDevices();

      expect(mockHb.logger.warn.calledWithMatch(/No devices found/)).to.be.true;
      expect(mockHb.api.unregisterPlatformAccessories.called).to.be.true;
      expect(platform.accessories).to.have.lengthOf(0);
      expect(stopPollingSpy.calledOnce).to.be.true;
    });

    it('discovers a new valid device and registers it', async () => {
      platform = createPlatform();
      getDevicesStub.resolves([
        { id: 'dev123', location: { name: 'Living Room' }, deviceType: 'WAVE', sensors: [] }
      ]);

      await platform.discoverDevices();

      expect(mockHb.logger.info.calledWithMatch(/Adding new accessory.*Living Room Sensor/)).to.be.true;
      expect(mockHb.api.registerPlatformAccessories.calledOnce).to.be.true;
      expect(platform.accessories).to.have.lengthOf(1);
    });

    it('uses fallback name if location name is missing', async () => {
      platform = createPlatform();
      getDevicesStub.resolves([
        { id: 'dev123', deviceType: 'WAVE', sensors: [] }
      ]);

      await platform.discoverDevices();
      expect(mockHb.logger.info.calledWithMatch(/Adding new accessory: Airthings dev123/)).to.be.true;
    });

    it('updates context and re-registers an existing valid accessory', async () => {
      platform = createPlatform();
      getDevicesStub.resolves([
        { id: 'dev123', location: { name: 'Living Room' }, deviceType: 'WAVE', sensors: [] }
      ]);

      const acc = mockHb.api.platformAccessory('Living Room Sensor', 'uuid-dev123');
      acc.context.device = { id: 'dev123', name: 'Old Name' };
      platform.configureAccessory(acc);

      await platform.discoverDevices();

      expect(mockHb.logger.info.calledWithMatch(/Restoring existing accessory/)).to.be.true;
      expect(mockHb.api.updatePlatformAccessories.calledWith([acc])).to.be.true;
      expect(acc.context.device.location.name).to.equal('Living Room');
      expect(platform.accessories).to.have.lengthOf(1); // the same one
    });

    it('ignores structurally invalid HUB devices', async () => {
      platform = createPlatform({ clientId: 't', clientSecret: 't', debugMode: true });
      getDevicesStub.resolves([
        { id: 'hub123', deviceType: 'HUB', sensors: [] }
      ]);

      await platform.discoverDevices();

      expect(mockHb.logger.info.calledWithMatch(/Filtering out structural HUB/)).to.be.true;
      expect(platform.accessories).to.have.lengthOf(0);
    });

    it('ignores devices in configured ignoredDevices list', async () => {
      platform = createPlatform({ clientId: 't', clientSecret: 't', ignoredDevices: ['dev123'] });
      getDevicesStub.resolves([
        { id: 'dev123', deviceType: 'WAVE', sensors: [] },
        { id: 'dev456', deviceType: 'WAVE', sensors: [] }
      ]);

      await platform.discoverDevices();

      expect(mockHb.logger.info.calledWithMatch(/Ignoring device due to config.ignoredDevices filter: dev123/)).to.be.true;
      expect(platform.accessories).to.have.lengthOf(1);
      expect(platform.accessories[0].context.device.id).to.equal('dev456');
    });

    it('only registers devices present in strict includedDevices list if configured', async () => {
      platform = createPlatform({ clientId: 't', clientSecret: 't', includedDevices: ['dev456'], debugMode: true });
      getDevicesStub.resolves([
        { id: 'dev123', deviceType: 'WAVE', sensors: [] },
        { id: 'dev456', deviceType: 'WAVE', sensors: [] }
      ]);

      await platform.discoverDevices();

      expect(mockHb.logger.info.calledWithMatch(/Skipping device absent from config.includedDevices: dev123/)).to.be.true;
      expect(platform.accessories).to.have.lengthOf(1);
      expect(platform.accessories[0].context.device.id).to.equal('dev456');
    });

    describe('Orphaned Accessories', () => {
      it('flags orphaned accessories but retains them during grace period', async () => {
        platform = createPlatform({ clientId: 't', clientSecret: 't', orphanGracePeriodDays: 7 });
        getDevicesStub.resolves([]);

        const acc = mockHb.api.platformAccessory('Orphan', 'uuid-dev123');
        acc.context.device = { id: 'dev123', deviceType: 'WAVE' }; // add dummy device props to ensure it's not considered HUB

        // Ensure its service has StatusFault
        const service = acc.addService('Mock', 'MockName');
        service.setCharacteristic(mockHb.api.hap.Characteristic.StatusFault, 0);

        platform.configureAccessory(acc);

        await platform.discoverDevices();

        // Should have set orphanedSince because device is not returned by getDevices
        expect(acc.context.orphanedSince).to.be.a('number');
        expect(mockHb.api.unregisterPlatformAccessories.called).to.be.false;

        // Should have flagged service as faulty
        const faultVal = service.characteristics.get(mockHb.api.hap.Characteristic.StatusFault)?.value;
        expect(faultVal).to.equal(1); // GENERAL_FAULT
      });

      it('safely recovers a returning orphaned accessory if it comes back', async () => {
        platform = createPlatform({ clientId: 't', clientSecret: 't' });
        getDevicesStub.resolves([
          { id: 'dev123', deviceType: 'WAVE', sensors: [] }
        ]);

        const acc = mockHb.api.platformAccessory('Recovered', 'uuid-dev123');
        acc.context.device = { id: 'dev123' };
        acc.context.orphanedSince = 12345;

        platform.configureAccessory(acc);

        await platform.discoverDevices();

        expect(acc.context.orphanedSince).to.be.undefined;
        expect(mockHb.api.unregisterPlatformAccessories.called).to.be.false;
      });
    });
  });
});

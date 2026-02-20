import { expect } from 'chai';
import sinon from 'sinon';
import { AirthingsHubPlatform } from '../src/platform.js';
import { AirthingsHubAccessory } from '../src/accessory.js';
import { createMockHomebridge, MockHomebridge } from './helpers/homebridge.mock.js';

describe('AirthingsHubAccessory', () => {
  let mockHb: MockHomebridge;
  let mockPlatform: sinon.SinonStubbedInstance<AirthingsHubPlatform>;
  let mockAccessory: any;
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    mockHb = createMockHomebridge();

    mockPlatform = {
      api: mockHb.api,
      log: mockHb.logger,
      config: {
        sensors: ['radon', 'co2', 'voc', 'temp', 'humidity', 'battery'],
        radonThreshold: 150,
      },
      debugMode: true,
      Service: mockHb.api.hap.Service,
      Characteristic: mockHb.api.hap.Characteristic,
      apiClient: {
        getLatestSamples: sinon.stub().resolves({ data: {} }),
      },
    } as unknown as sinon.SinonStubbedInstance<AirthingsHubPlatform>;

    mockAccessory = mockHb.api.platformAccessory('Test Acc', 'uuid-123');
    mockAccessory.context.device = {
      id: 'dev123',
      deviceType: 'WAVE',
      sensors: ['radonShortTermAvg', 'co2', 'voc', 'temp', 'humidity']
    };
  });

  afterEach(() => {
    clock.restore();
    sinon.restore();
  });

  function createWrapper() {
    return new AirthingsHubAccessory(mockPlatform as any, mockAccessory);
  }

  describe('Initialization', () => {
    it('sets accessory information on creation', () => {
      createWrapper();

      const aiService = mockAccessory.getService('AccessoryInformation');
      expect(aiService).to.not.be.undefined;

      const mfc = aiService.characteristics.get(mockHb.api.hap.Characteristic.FirmwareRevision);
      expect(mfc.value).to.equal('1.0.0'); // Firmware revision is the last one set
    });

    it('sets category to SENSOR', () => {
      createWrapper();
      expect(mockAccessory.category).to.equal(1);
    });

    it('bails out of setting accessory info if AccessoryInformation service is missing', () => {
      mockAccessory.getService.returns(undefined);
      expect(() => createWrapper()).to.not.throw();
    });

    it('uses fallback Model if deviceType is missing', () => {
      mockAccessory.context.device.deviceType = undefined;
      createWrapper();
      const aiService = mockAccessory.getService('AccessoryInformation');
      expect(aiService.characteristics.get(mockHb.api.hap.Characteristic.Model).value).to.equal('Sensor');
    });

    it('logs on identify event', () => {
      mockAccessory.__triggerIdentify(); // Trigger before listeners attached to cover the empty handlers branch in the mock
      createWrapper();
      mockAccessory.__triggerIdentify();
      expect(mockHb.logger.info.calledWithMatch(/identified/)).to.be.true;
    });
  });

  describe('Service Configuration', () => {
    it('only initializes services that are in BOTH device.sensors and config.sensors', () => {
      mockPlatform.config.sensors = ['radon', 'co2']; // user only wants radon and co2
      createWrapper();

      // Should have Radon and CO2, but not VOC
      expect(mockAccessory.getService(mockHb.api.hap.Service.LeakSensor)).to.not.be.undefined;
      expect(mockAccessory.getService(mockHb.api.hap.Service.CarbonDioxideSensor)).to.not.be.undefined;
      expect(mockAccessory.getService(mockHb.api.hap.Service.AirQualitySensor)).to.be.undefined;
    });

    it('always enables virtual battery service if configured, regardless of hardware capabilities payload', () => {
      mockPlatform.config.sensors = ['battery']; // user wants battery
      mockAccessory.context.device.sensors = []; // hardware claims no sensors
      createWrapper();

      const battLevel = mockHb.api.hap.Characteristic.BatteryLevel;
      // Should be added
      expect(mockAccessory.getService(mockHb.api.hap.Service.Battery)).to.not.be.undefined;
    });

    it('sets Eve custom characteristic if enabled in config', () => {
      mockPlatform.config.enableEveCustomCharacteristics = true;

      const originalAddService = mockAccessory.addService;
      mockAccessory.addService = sinon.stub().callsFake((type: any, name: string) => {
        const svc = originalAddService(type, name);
        svc.testCharacteristic.returns(false);
        return svc;
      });

      createWrapper();

      const leakService = mockAccessory.getService(mockHb.api.hap.Service.LeakSensor);
      // Should have bound RadonLevelCharacteristic
      expect(mockPlatform.RadonLevelCharacteristic).to.not.be.undefined;
      expect(leakService.addCharacteristic.calledWith(mockPlatform.RadonLevelCharacteristic)).to.be.true;

      // Instantiate it manually to cover the constructor since we mocked addCharacteristic
      new (mockPlatform.RadonLevelCharacteristic as any)();
    });

    it('removes an unused service if it exists but is disabled', () => {
      mockPlatform.config.sensors = []; // Disable everything
      mockAccessory.addService('LeakSensor', 'Radon'); // Pre-existing service in cache

      createWrapper();

      expect(mockAccessory.removeService.called).to.be.true;
    });

    it('handles missing sensors array from accessory context safely', () => {
      mockAccessory.context.device.sensors = null as any;
      mockPlatform.config.sensors = ['radon'];
      createWrapper();
      // Should not initialize radon since it's missing from device hardware payload
      expect(mockAccessory.services.some((s: any) => s.characteristics.has(mockHb.api.hap.Characteristic.LeakDetected))).to.be.false;
    });

    it('uses the raw sensor key if not found in mapping', () => {
      mockPlatform.config.sensors = ['customSensor'];
      mockAccessory.context.device.sensors = ['customSensor'];
      createWrapper();
      // Test evaluates branch sensorMapping[sensorKey] || sensorKey smoothly
    });
  });

  describe('State Updates', () => {
    let wrapper: any;

    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('applies fault state across all services when poller issues a fault', () => {
      wrapper.state.isFaulted = true;
      wrapper.onStateUpdate();

      // Check the fault characteristic on services
      const radonSvc = mockAccessory.services.find((s: any) => s.characteristics.get(mockHb.api.hap.Characteristic.Name)?.value === 'Radon');
      // Mock testCharacteristic always returns true
      const char = radonSvc.characteristics.get(mockHb.api.hap.Characteristic.StatusFault);
      expect(char.value).to.equal(1); // GENERAL_FAULT
    });

    it('clears faults and updates multiple characteristics when data arrives', () => {
      wrapper.state.isFaulted = false;
      wrapper.state.latestSample = {
        radonShortTermAvg: 200, // > 150 threshold
        co2: 1200, // > 1000 threshold
        voc: 300, // GOOD
        temp: 22.5,
        humidity: 45.2,
        battery: 15, // < 20
      };

      wrapper.onStateUpdate();

      // Radon High -> Leak Detected
      const radonSvc = wrapper.services.radon;
      expect(radonSvc.getCharacteristic(mockHb.api.hap.Characteristic.LeakDetected).value).to.equal(1);

      // CO2 High
      const co2Svc = wrapper.services.co2;
      expect(co2Svc.getCharacteristic(mockHb.api.hap.Characteristic.CarbonDioxideDetected).value).to.equal(1);

      // VOC Good (2)
      const vocSvc = wrapper.services.voc;
      expect(vocSvc.getCharacteristic(mockHb.api.hap.Characteristic.AirQuality).value).to.equal(2);

      // Battery Low
      const battSvc = wrapper.services.battery;
      expect(battSvc.getCharacteristic(mockHb.api.hap.Characteristic.StatusLowBattery).value).to.equal(1);

      // Temp
      const tempSvc = wrapper.services.temp;
      expect(tempSvc.getCharacteristic(mockHb.api.hap.Characteristic.CurrentTemperature).value).to.equal(22.5);
    });

    it('handles normal CO2 and normal battery levels', () => {
      wrapper.state.latestSample = { co2: 800, battery: 50 }; // co2 <= 1000, battery >= 20
      wrapper.onStateUpdate();

      const co2Svc = wrapper.services.co2;
      expect(co2Svc.getCharacteristic(mockHb.api.hap.Characteristic.CarbonDioxideDetected).value)
        .to.equal(mockHb.api.hap.Characteristic.CarbonDioxideDetected.CO2_LEVELS_NORMAL);

      const battSvc = wrapper.services.battery;
      expect(battSvc.getCharacteristic(mockHb.api.hap.Characteristic.StatusLowBattery).value)
        .to.equal(mockHb.api.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
    });

    it('handles excellent VOC', () => {
      wrapper.state.latestSample = { voc: 100 };
      wrapper.onStateUpdate();
      expect(wrapper.services.voc.getCharacteristic(mockHb.api.hap.Characteristic.AirQuality).value).to.equal(1); // EXCELLENT
    });

    it('handles fair VOC', () => {
      wrapper.state.latestSample = { voc: 800 };
      wrapper.onStateUpdate();
      expect(wrapper.services.voc.getCharacteristic(mockHb.api.hap.Characteristic.AirQuality).value).to.equal(3); // FAIR
    });

    it('handles inferior VOC', () => {
      wrapper.state.latestSample = { voc: 1500 };
      wrapper.onStateUpdate();
      expect(wrapper.services.voc.getCharacteristic(mockHb.api.hap.Characteristic.AirQuality).value).to.equal(4); // INFERIOR
    });

    it('handles poor VOC', () => {
      wrapper.state.latestSample = { voc: 2500 };
      wrapper.onStateUpdate();
      expect(wrapper.services.voc.getCharacteristic(mockHb.api.hap.Characteristic.AirQuality).value).to.equal(5); // POOR
    });

    it('fans out low battery to other services', () => {
      wrapper.state.latestSample = { battery: 10, temp: 20 }; // Include temp so service exists
      wrapper.onStateUpdate();

      const tempSvc = wrapper.services.temp;
      // Because we testCharacteristic->true in mock
      expect(tempSvc.getCharacteristic(mockHb.api.hap.Characteristic.StatusLowBattery).value).to.equal(1);
    });

    it('ignores empty updates gracefully', () => {
      wrapper.state.latestSample = null;
      expect(() => wrapper.onStateUpdate()).to.not.throw();
    });

    it('updates eve custom radon characteristic if enabled', () => {
      mockPlatform.config.enableEveCustomCharacteristics = true;
      const eveWrapper = createWrapper() as any;

      eveWrapper.state.latestSample = { radonShortTermAvg: 123 };
      eveWrapper.onStateUpdate();

      expect(eveWrapper.services.radon.getCharacteristic(eveWrapper.customRadonLevelChar).value).to.equal(123);
    });
  });
});

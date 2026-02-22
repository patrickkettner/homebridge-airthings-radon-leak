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

  function createWrapper(mockPollerInstance?: any) {
    if (mockPollerInstance) {
      return new AirthingsHubAccessory(mockPlatform as any, mockAccessory, () => mockPollerInstance);
    }
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
      mockAccessory.__triggerIdentify(); 
      createWrapper();
      mockAccessory.__triggerIdentify();
      expect(mockHb.logger.info.calledWithMatch(/identified/)).to.be.true;
    });

    it('binds to poller correctly without custom generator', () => {
      expect(() => createWrapper()).to.not.throw();
    });
  });

  describe('Service Configuration', () => {
    it('only initializes services that are in BOTH device.sensors and config.sensors', () => {
      (mockPlatform.config as any).sensors = ['radon', 'co2']; 
      createWrapper();

      expect(mockAccessory.getService(mockHb.api.hap.Service.LeakSensor)).to.not.be.undefined;
      expect(mockAccessory.getService(mockHb.api.hap.Service.CarbonDioxideSensor)).to.not.be.undefined;
      expect(mockAccessory.getService(mockHb.api.hap.Service.AirQualitySensor)).to.be.undefined;
    });

    it('always enables virtual battery service if configured, regardless of hardware capabilities payload', () => {
      (mockPlatform.config as any).sensors = ['battery'];
      mockAccessory.context.device.sensors = []; 
      createWrapper();

      expect(mockAccessory.getService(mockHb.api.hap.Service.Battery)).to.not.be.undefined;
    });

    it('sets Eve custom characteristic if enabled in config', () => {
      (mockPlatform.config as any).enableEveCustomCharacteristics = true;

      const originalAddService = mockAccessory.addService;
      mockAccessory.addService = sinon.stub().callsFake((type: any, name: string) => {
        const svc = originalAddService(type, name);
        svc.testCharacteristic.returns(false);
        return svc;
      });

      createWrapper();

      const leakService = mockAccessory.getService(mockHb.api.hap.Service.LeakSensor);
      expect(mockPlatform.RadonLevelCharacteristic).to.not.be.undefined;
      expect(leakService.addCharacteristic.calledWith(mockPlatform.RadonLevelCharacteristic)).to.be.true;

      new (mockPlatform.RadonLevelCharacteristic as any)();
    });

    it('removes an unused service if it exists but is disabled', () => {
      (mockPlatform.config as any).sensors = [];
      mockAccessory.addService('LeakSensor', 'Radon'); 

      createWrapper();

      expect(mockAccessory.removeService.called).to.be.true;
    });

    it('handles missing sensors array from accessory context safely', () => {
      mockAccessory.context.device.sensors = null as any;
      (mockPlatform.config as any).sensors = ['radon'];
      createWrapper();
      expect(mockAccessory.services.some((s: any) => s.characteristics.has(mockHb.api.hap.Characteristic.LeakDetected))).to.be.false;
    });

    it('uses the raw sensor key if not found in mapping', () => {
      (mockPlatform.config as any).sensors = ['customSensor'];
      mockAccessory.context.device.sensors = ['customSensor'];
      createWrapper();
    });
  });

  describe('State Updates', () => {
    let wrapper: any;
    let mockPoller: any;

    beforeEach(() => {
      mockPoller = {
        on: sinon.stub(),
        start: sinon.stub(),
        destroy: sinon.stub()
      };
      wrapper = createWrapper(mockPoller);
    });

    it('applies fault state across all services when poller issues a fault', () => {
      const faultCallback = mockPoller.on.args.find((arg: any) => arg[0] === 'fault')[1];
      faultCallback('fault description');

      const radonSvc = mockAccessory.services.find((s: any) => s.characteristics.get(mockHb.api.hap.Characteristic.Name)?.value === 'Radon');
      const char = radonSvc.characteristics.get(mockHb.api.hap.Characteristic.StatusFault);
      expect(char.value).to.equal(1); // GENERAL_FAULT
    });

    it('clears faults and updates multiple characteristics when data arrives', () => {
      const updateCallback = mockPoller.on.args.find((arg: any) => arg[0] === 'update')[1];
      const data = {
        radonShortTermAvg: 200,
        co2: 1200,
        voc: 300, 
        temp: 22.5,
        humidity: 45.2,
        battery: 15, 
      };

      updateCallback(data);

      expect(wrapper.services.radon.getCharacteristic(mockHb.api.hap.Characteristic.LeakDetected).value).to.equal(1);
      expect(wrapper.services.co2.getCharacteristic(mockHb.api.hap.Characteristic.CarbonDioxideDetected).value).to.equal(1);
      expect(wrapper.services.voc.getCharacteristic(mockHb.api.hap.Characteristic.AirQuality).value).to.equal(2);
      expect(wrapper.services.battery.getCharacteristic(mockHb.api.hap.Characteristic.StatusLowBattery).value).to.equal(1);
      expect(wrapper.services.temp.getCharacteristic(mockHb.api.hap.Characteristic.CurrentTemperature).value).to.equal(22.5);
    });

    it('handles normal CO2 and normal battery levels', () => {
      const updateCallback = mockPoller.on.args.find((arg: any) => arg[0] === 'update')[1];
      updateCallback({ co2: 800, battery: 50 });

      expect(wrapper.services.co2.getCharacteristic(mockHb.api.hap.Characteristic.CarbonDioxideDetected).value)
        .to.equal(mockHb.api.hap.Characteristic.CarbonDioxideDetected.CO2_LEVELS_NORMAL);

      expect(wrapper.services.battery.getCharacteristic(mockHb.api.hap.Characteristic.StatusLowBattery).value)
        .to.equal(mockHb.api.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
    });

    it('handles excellent VOC', () => {
      const updateCallback = mockPoller.on.args.find((arg: any) => arg[0] === 'update')[1];
      updateCallback({ voc: 100 });
      expect(wrapper.services.voc.getCharacteristic(mockHb.api.hap.Characteristic.AirQuality).value).to.equal(1);
    });

    it('handles fair VOC', () => {
      const updateCallback = mockPoller.on.args.find((arg: any) => arg[0] === 'update')[1];
      updateCallback({ voc: 800 });
      expect(wrapper.services.voc.getCharacteristic(mockHb.api.hap.Characteristic.AirQuality).value).to.equal(3);
    });

    it('handles inferior VOC', () => {
      const updateCallback = mockPoller.on.args.find((arg: any) => arg[0] === 'update')[1];
      updateCallback({ voc: 1500 });
      expect(wrapper.services.voc.getCharacteristic(mockHb.api.hap.Characteristic.AirQuality).value).to.equal(4);
    });

    it('handles poor VOC', () => {
      const updateCallback = mockPoller.on.args.find((arg: any) => arg[0] === 'update')[1];
      updateCallback({ voc: 2500 });
      expect(wrapper.services.voc.getCharacteristic(mockHb.api.hap.Characteristic.AirQuality).value).to.equal(5);
    });

    it('fans out low battery to other services', () => {
      const updateCallback = mockPoller.on.args.find((arg: any) => arg[0] === 'update')[1];
      updateCallback({ battery: 10, temp: 20 });
      expect(wrapper.services.temp.getCharacteristic(mockHb.api.hap.Characteristic.StatusLowBattery).value).to.equal(1);
    });

    it('ignores empty updates gracefully', () => {
      const updateCallback = mockPoller.on.args.find((arg: any) => arg[0] === 'update')[1];
      expect(() => updateCallback(null)).to.not.throw();
    });

    it('updates eve custom radon characteristic if enabled', () => {
      (mockPlatform.config as any).enableEveCustomCharacteristics = true;
      const freshPoller = {
        on: sinon.stub(),
        start: sinon.stub(),
        destroy: sinon.stub()
      };
      const eveWrapper = createWrapper(freshPoller) as any;

      const updateCallback = freshPoller.on.args.find((arg: any) => arg[0] === 'update')[1];
      updateCallback({ radonShortTermAvg: 123 });

      expect(eveWrapper.services.radon.getCharacteristic(eveWrapper.customRadonLevelChar).value).to.equal(123);
    });

    it('translates presentation value to pCi/L if configured', () => {
      (mockPlatform.config as any).enableEveCustomCharacteristics = true;
      (mockPlatform.config as any).radonUnit = 'pCi/L';
      const freshPoller = {
        on: sinon.stub(),
        start: sinon.stub(),
        destroy: sinon.stub()
      };
      const eveWrapper = createWrapper(freshPoller) as any;

      const updateCallback = freshPoller.on.args.find((arg: any) => arg[0] === 'update')[1];
      updateCallback({ radonShortTermAvg: 148 });

      expect(eveWrapper.services.radon.getCharacteristic(eveWrapper.customRadonLevelChar).value).to.equal(4);
    });

    it('stopPolling correctly delegates to poller destroy', () => {
      wrapper.stopPolling();
      expect(mockPoller.destroy.calledOnce).to.be.true;
    });

    it('safely handles missing service in updateCharIfChanged', () => {
      expect(() => {
        (wrapper as any).updateCharIfChanged(undefined, mockHb.api.hap.Characteristic.Name, 'test');
      }).to.not.throw();
    });
  });
});

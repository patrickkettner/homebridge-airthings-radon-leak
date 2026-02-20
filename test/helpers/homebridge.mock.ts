import sinon from 'sinon';
import { API, Logger, PlatformAccessory, Service, Characteristic } from 'homebridge';

export interface MockHomebridge {
  api: sinon.SinonStubbedInstance<API> & {
    hap: any;
    platformAccessory: sinon.SinonStub;
  };
  logger: sinon.SinonStubbedInstance<Logger>;
}

export function createMockHomebridge(): MockHomebridge {
  const mockLogger = {
    info: sinon.stub(),
    warn: sinon.stub(),
    error: sinon.stub(),
    debug: sinon.stub(),
    log: sinon.stub(),
  };

  class MockCharacteristic {
    static readonly Formats = { FLOAT: 'float', STRING: 'string' };
    static readonly Perms = { READ: 'pr', NOTIFY: 'ev' };

    // Static predefined values required by homebridge logic
    static readonly Manufacturer = 'Manufacturer';
    static readonly Model = 'Model';
    static readonly SerialNumber = 'SerialNumber';
    static readonly FirmwareRevision = 'FirmwareRevision';
    static readonly Name = 'Name';

    static readonly LeakDetected = class { static readonly LEAK_NOT_DETECTED = 0; static readonly LEAK_DETECTED = 1; };
    static readonly AirQuality = class { static readonly EXCELLENT = 1; static readonly GOOD = 2; static readonly FAIR = 3; static readonly INFERIOR = 4; static readonly POOR = 5; static readonly UNKNOWN = 0; };
    static readonly VOCDensity = 'VOCDensity';
    static readonly CarbonDioxideLevel = 'CarbonDioxideLevel';
    static readonly CarbonDioxideDetected = class { static readonly CO2_LEVELS_NORMAL = 0; static readonly CO2_LEVELS_ABNORMAL = 1; };
    static readonly CurrentTemperature = 'CurrentTemperature';
    static readonly CurrentRelativeHumidity = 'CurrentRelativeHumidity';
    static readonly BatteryLevel = 'BatteryLevel';
    static readonly ChargingState = class { static readonly NOT_CHARGEABLE = 2; };
    static readonly StatusLowBattery = class { static readonly BATTERY_LEVEL_NORMAL = 0; static readonly BATTERY_LEVEL_LOW = 1; };
    static readonly StatusFault = class { static readonly NO_FAULT = 0; static readonly GENERAL_FAULT = 1; };

    // Instance members
    public value: any = undefined;
    public props: any = {};

    constructor(public displayName: string, public UUID: string, props: any = {}) {
      this.props = props;
    }

    setProps = sinon.stub().returnsThis();
    updateValue = sinon.stub().callsFake((val: any) => {
      this.value = val;
      return this;
    });

    getDefaultValue = sinon.stub().returns(0);

    onGet = sinon.stub().returnsThis();
    onSet = sinon.stub().returnsThis();
  }

  class MockService {
    public characteristics: Map<any, MockCharacteristic> = new Map();

    setCharacteristic = sinon.stub().callsFake((type: any, value: any) => {
      let char = this.characteristics.get(type);
      if (!char) {
        char = new MockCharacteristic('Mock', 'MockUUID');
        this.characteristics.set(type, char);
      }
      char.updateValue(value);
      return this;
    });

    getCharacteristic = sinon.stub().callsFake((type: any) => {
      let char = this.characteristics.get(type);
      if (!char) {
        char = new MockCharacteristic('Mock', 'MockUUID');
        this.characteristics.set(type, char);
      }
      return char;
    });

    updateCharacteristic = sinon.stub().callsFake((type: any, value: any) => {
      const char = this.getCharacteristic(type);
      char.updateValue(value);
      return this;
    });

    testCharacteristic = sinon.stub().returns(true);
    addCharacteristic = sinon.stub().returnsThis();
  }

  class MockPlatformAccessory {
    public services: MockService[] = [];
    public context: any = { device: {} };
    public category = 0;

    private readonly serviceMap = new Map<any, MockService>();
    private readonly events = new Map<string, Function[]>();

    constructor(public displayName: string, public UUID: string) {
      const infoService = new MockService();
      this.serviceMap.set('AccessoryInformation', infoService);
    }

    getService = sinon.stub().callsFake((type: any) => this.serviceMap.get(type));
    addService = sinon.stub().callsFake((type: any, name: string) => {
      const newService = new MockService();
      this.serviceMap.set(type, newService);
      this.services.push(newService);
      return newService;
    });
    removeService = sinon.stub().callsFake((service: MockService) => {
      this.services = this.services.filter(s => s !== service);
    });

    on = sinon.stub().callsFake((event: string, handler: Function) => {
      if (!this.events.has(event)) {
        this.events.set(event, []);
      }
      this.events.get(event)?.push(handler);
      return this;
    });

    // Helper to simulate identify
    __triggerIdentify() {
      const handlers = this.events.get('identify') || [];
      handlers.forEach(h => h());
    }
  }

  // Create hap namespace
  const hap = {
    Categories: { SENSOR: 1 },
    uuid: {
      generate: sinon.stub().callsFake((id: string) => `uuid-${id}`),
    },
    Service: {
      AccessoryInformation: 'AccessoryInformation',
      LeakSensor: 'LeakSensor',
      CarbonDioxideSensor: 'CarbonDioxideSensor',
      AirQualitySensor: 'AirQualitySensor',
      TemperatureSensor: 'TemperatureSensor',
      HumiditySensor: 'HumiditySensor',
      Battery: 'Battery',
    },
    Characteristic: MockCharacteristic,
  };

  const apiStub = {
    on: sinon.stub(),
    registerPlatform: sinon.stub(),
    registerPlatformAccessories: sinon.stub(),
    unregisterPlatformAccessories: sinon.stub(),
    updatePlatformAccessories: sinon.stub(),
    hap,
    platformAccessory: sinon.stub().callsFake((name, uuid) => new MockPlatformAccessory(name, uuid)),
  } as unknown as sinon.SinonStubbedInstance<API> & { hap: any; platformAccessory: sinon.SinonStub };

  return {
    api: apiStub,
    logger: mockLogger as unknown as sinon.SinonStubbedInstance<Logger>,
  };
}

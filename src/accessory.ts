import { Service, PlatformAccessory, Characteristic } from 'homebridge';
import { AirthingsHubPlatform } from './platform.js';
import {
  DEFAULT_POLL_INTERVAL_MS,
  RADON_CHARACTERISTIC_UUID,
  EXCELLENT_VOC_THRESHOLD,
  GOOD_VOC_THRESHOLD,
  FAIR_VOC_THRESHOLD,
  INFERIOR_VOC_THRESHOLD,
  HIGH_CO2_THRESHOLD,
  LOW_BATTERY_THRESHOLD
} from './constants.js';
import { DeviceState, createInitialState } from './state.js';
import { DevicePoller } from './poller.js';

export class AirthingsHubAccessory {
  private readonly services: Record<string, Service> = {};
  private readonly state: DeviceState = createInitialState();
  private readonly poller: DevicePoller;
  private customRadonLevelChar?: any;

  constructor(
    private readonly platform: AirthingsHubPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    if (this.platform.debugMode) {
      this.platform.log.info(`[DEBUG] Initializing Accessory: ${accessory.displayName}`);
    }

    this.accessory.category = this.platform.api.hap.Categories.SENSOR;

    this.accessory.on('identify', () => {
      this.platform.log.info(`${this.accessory.displayName} identified!`);
    });

    this.configureAccessoryInformation();
    this.configureServices();

    this.poller = new DevicePoller(
      this.accessory.context.device.id,
      this.platform.apiClient,
      this.state,
      this.platform.log,
      DEFAULT_POLL_INTERVAL_MS,
      () => this.onStateUpdate(),
      this.platform.debugMode
    );

    this.poller.start();
  }

  public stopPolling(): void {
    this.poller.stop();
  }

  private configureAccessoryInformation(): void {
    const aiService = this.accessory.getService(this.platform.Service.AccessoryInformation);
    if (!aiService) {
      return;
    }

    aiService
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Airthings')
      .setCharacteristic(this.platform.Characteristic.Model, this.accessory.context.device.deviceType || 'Sensor')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.context.device.id)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, '1.0.0');
  }

  private configureServices(): void {
    const configSensors = this.platform.config.sensors;
    const deviceSensors = this.accessory.context.device.sensors || [];

    const sensorMapping: Record<string, string> = {
      radon: 'radonShortTermAvg',
      co2: 'co2',
      voc: 'voc',
      temp: 'temp',
      humidity: 'humidity',
      battery: 'battery',
    };

    const activeSensors = configSensors.filter(sensorKey => {
      if (sensorKey === 'battery') {
        return true;
      }
      return deviceSensors.includes(sensorMapping[sensorKey] || sensorKey);
    });

    this.manageRadonService(activeSensors.includes('radon'));
    this.manageCo2Service(activeSensors.includes('co2'));
    this.manageVocService(activeSensors.includes('voc'));
    this.manageTempService(activeSensors.includes('temp'));
    this.manageHumidityService(activeSensors.includes('humidity'));
    this.manageBatteryService(activeSensors.includes('battery'));
  }

  private getOrAddService(serviceClass: any, name: string): Service {
    let service = this.accessory.getService(serviceClass);
    if (!service) {
      service = this.accessory.addService(serviceClass, name);
    }
    service.setCharacteristic(this.platform.Characteristic.Name, name);
    service.setCharacteristic(this.platform.Characteristic.StatusFault, this.platform.Characteristic.StatusFault.NO_FAULT);
    return service;
  }

  private removeService(serviceClass: any): void {
    const service = this.accessory.getService(serviceClass);
    if (service) {
      this.accessory.removeService(service);
    }
  }

  private manageRadonService(enable: boolean): void {
    if (!enable) {
      return this.removeService(this.platform.Service.LeakSensor);
    }

    this.services.radon = this.getOrAddService(this.platform.Service.LeakSensor, 'Radon');

    // Ensure initial state
    const leakChar = this.services.radon.getCharacteristic(this.platform.Characteristic.LeakDetected);
    if (leakChar.value === undefined || leakChar.value === null) {
      leakChar.updateValue(this.platform.Characteristic.LeakDetected.LEAK_NOT_DETECTED);
    }

    if (this.platform.config.enableEveCustomCharacteristics) {
      this.setupEveCustomRadonCharacteristic();
    }
  }

  private setupEveCustomRadonCharacteristic(): void {
    const hapChar = this.platform.Characteristic;

    // Create class dynamically if it does not exist on platform
    if (!this.platform.RadonLevelCharacteristic) {
      class RadonLevelCharacteristic extends hapChar {
        public static readonly UUID: string = RADON_CHARACTERISTIC_UUID;
        constructor() {
          super('Radon Level', RADON_CHARACTERISTIC_UUID, {
            format: hapChar.Formats.FLOAT,
            unit: 'Bq/m3',
            minValue: 0,
            maxValue: 10000,
            minStep: 1,
            perms: [hapChar.Perms.READ, hapChar.Perms.NOTIFY],
          });
          this.value = this.getDefaultValue();
        }
      }
      this.platform.RadonLevelCharacteristic = RadonLevelCharacteristic as any;
    }

    this.customRadonLevelChar = this.platform.RadonLevelCharacteristic;

    if (!this.services.radon.testCharacteristic(this.customRadonLevelChar)) {
      this.services.radon.addCharacteristic(this.customRadonLevelChar);
    }
  }

  private manageCo2Service(enable: boolean): void {
    if (!enable) {
      return this.removeService(this.platform.Service.CarbonDioxideSensor);
    }

    this.services.co2 = this.getOrAddService(this.platform.Service.CarbonDioxideSensor, 'CO2');

    const levelChar = this.services.co2.getCharacteristic(this.platform.Characteristic.CarbonDioxideLevel);
    levelChar.setProps({ minValue: 0, maxValue: 100000, minStep: 1 });
  }

  private manageVocService(enable: boolean): void {
    if (!enable) {
      return this.removeService(this.platform.Service.AirQualitySensor);
    }

    this.services.voc = this.getOrAddService(this.platform.Service.AirQualitySensor, 'Air Quality');
  }

  private manageTempService(enable: boolean): void {
    if (!enable) {
      return this.removeService(this.platform.Service.TemperatureSensor);
    }

    this.services.temp = this.getOrAddService(this.platform.Service.TemperatureSensor, 'Temperature');
    const tempChar = this.services.temp.getCharacteristic(this.platform.Characteristic.CurrentTemperature);
    tempChar.setProps({ minValue: -50, maxValue: 100, minStep: 0.1 });
  }

  private manageHumidityService(enable: boolean): void {
    if (!enable) {
      return this.removeService(this.platform.Service.HumiditySensor);
    }

    this.services.humidity = this.getOrAddService(this.platform.Service.HumiditySensor, 'Humidity');
  }

  private manageBatteryService(enable: boolean): void {
    if (!enable) {
      return this.removeService(this.platform.Service.Battery);
    }

    this.services.battery = this.getOrAddService(this.platform.Service.Battery, 'Battery');
    this.services.battery.setCharacteristic(
      this.platform.Characteristic.ChargingState,
      this.platform.Characteristic.ChargingState.NOT_CHARGEABLE
    );
  }

  /**
   * Translates the unified DeviceState into Homebridge characteristic updates.
   */
  private onStateUpdate(): void {
    if (this.state.isFaulted) {
      this.applyFaultState(this.platform.Characteristic.StatusFault.GENERAL_FAULT);
      return;
    }

    this.applyFaultState(this.platform.Characteristic.StatusFault.NO_FAULT);

    const data = this.state.latestSample;
    if (!data) {
      return;
    }

    this.updateRadonCharacteristics(data.radonShortTermAvg);
    this.updateCo2Characteristics(data.co2);
    this.updateVocCharacteristics(data.voc);
    this.updateTempCharacteristics(data.temp);
    this.updateHumidityCharacteristics(data.humidity);
    this.updateBatteryCharacteristics(data.battery);
  }

  private applyFaultState(faultStatus: number): void {
    for (const service of Object.values(this.services)) {
      if (service.testCharacteristic(this.platform.Characteristic.StatusFault)) {
        service.updateCharacteristic(this.platform.Characteristic.StatusFault, faultStatus);
      }
    }
  }

  private updateRadonCharacteristics(radonLevel?: number): void {
    if (!this.services.radon || typeof radonLevel !== 'number') {
      return;
    }

    const { Characteristic } = this.platform;
    const isLeak = radonLevel > this.platform.config.radonThreshold;
    const leakStatus = isLeak ? Characteristic.LeakDetected.LEAK_DETECTED : Characteristic.LeakDetected.LEAK_NOT_DETECTED;

    this.services.radon.updateCharacteristic(Characteristic.LeakDetected, leakStatus);

    if (this.customRadonLevelChar) {
      this.services.radon.updateCharacteristic(this.customRadonLevelChar, radonLevel);
    }
  }

  private updateCo2Characteristics(co2Level?: number): void {
    if (!this.services.co2 || typeof co2Level !== 'number') {
      return;
    }

    const { Characteristic } = this.platform;
    this.services.co2.updateCharacteristic(Characteristic.CarbonDioxideLevel, co2Level);

    const isHigh = co2Level > HIGH_CO2_THRESHOLD;
    const detectStatus = isHigh ? Characteristic.CarbonDioxideDetected.CO2_LEVELS_ABNORMAL : Characteristic.CarbonDioxideDetected.CO2_LEVELS_NORMAL;

    this.services.co2.updateCharacteristic(Characteristic.CarbonDioxideDetected, detectStatus);
  }

  private updateVocCharacteristics(vocLevel?: number): void {
    if (!this.services.voc || typeof vocLevel !== 'number') {
      return;
    }

    const { Characteristic } = this.platform;
    this.services.voc.updateCharacteristic(Characteristic.VOCDensity, vocLevel);

    let quality = Characteristic.AirQuality.UNKNOWN;
    if (vocLevel <= EXCELLENT_VOC_THRESHOLD) {
      quality = Characteristic.AirQuality.EXCELLENT;
    } else if (vocLevel <= GOOD_VOC_THRESHOLD) {
      quality = Characteristic.AirQuality.GOOD;
    } else if (vocLevel <= FAIR_VOC_THRESHOLD) {
      quality = Characteristic.AirQuality.FAIR;
    } else if (vocLevel <= INFERIOR_VOC_THRESHOLD) {
      quality = Characteristic.AirQuality.INFERIOR;
    } else {
      quality = Characteristic.AirQuality.POOR;
    }

    this.services.voc.updateCharacteristic(Characteristic.AirQuality, quality);
  }

  private updateTempCharacteristics(temp?: number): void {
    if (!this.services.temp || typeof temp !== 'number') {
      return;
    }
    this.services.temp.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, temp);
  }

  private updateHumidityCharacteristics(humidity?: number): void {
    if (!this.services.humidity || typeof humidity !== 'number') {
      return;
    }
    this.services.humidity.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, humidity);
  }

  private updateBatteryCharacteristics(battery?: number): void {
    if (typeof battery !== 'number') {
      return;
    }

    const { Characteristic } = this.platform;
    const isLow = battery < LOW_BATTERY_THRESHOLD ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;

    if (this.services.battery) {
      this.services.battery.updateCharacteristic(Characteristic.BatteryLevel, battery);
      this.services.battery.updateCharacteristic(Characteristic.StatusLowBattery, isLow);
    }

    // Standard Homebridge behavior: fan out low battery status to all other active services
    for (const service of Object.values(this.services)) {
      if (service !== this.services.battery && service.testCharacteristic(Characteristic.StatusLowBattery)) {
        service.updateCharacteristic(Characteristic.StatusLowBattery, isLow);
      }
    }
  }
}

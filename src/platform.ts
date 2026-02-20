import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME, DEVICE_TYPE_HUB } from './constants.js';
import { AirthingsHubConfig, AirthingsDevice } from './types.js';
import { AirthingsHubAccessory } from './accessory.js';
import { AirthingsApiClient } from './api.js';
import { parseConfig } from './config.js';

export class AirthingsHubPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly config: AirthingsHubConfig;
  public readonly accessories: PlatformAccessory[] = [];
  public readonly apiClient: AirthingsApiClient;
  public readonly debugMode: boolean;

  private readonly activeWrappers: Map<string, AirthingsHubAccessory> = new Map();
  // Custom Characteristics registry
  public RadonLevelCharacteristic?: typeof Characteristic;

  constructor(
    public readonly log: Logger,
    rawConfig: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    this.config = parseConfig(rawConfig, this.log);
    this.debugMode = this.config.debugMode;

    this.apiClient = new AirthingsApiClient(
      this.config.clientId,
      this.config.clientSecret,
      this.log,
      this.debugMode,
    );

    this.log.debug('Finished initializing platform:', this.config.name);

    if (!this.config.clientId || !this.config.clientSecret) {
      // Stop initialization gracefully if missing auth
      return;
    }

    this.api.on('didFinishLaunching', () => {
      this.discoverDevices().catch(err => {
        const message = err instanceof Error ? err.message : String(err);
        this.log.error(`Failed to run initial device discovery. ${message}`);
      });
    });

    this.api.on('shutdown', () => {
      if (this.debugMode) {
        this.log.info('[DEBUG] Terminating all active polling loops for shutdown.');
      }
      for (const wrapper of this.activeWrappers.values()) {
        wrapper.stopPolling();
      }
    });
  }

  /**
   * Called by Homebridge when restoring cached accessories.
   */
  public configureAccessory(accessory: PlatformAccessory): void {
    if (this.debugMode) {
      this.log.info(`[DEBUG] Loading accessory from cache: ${accessory.displayName}`);
    }
    this.accessories.push(accessory);
  }

  /**
   * Fetches the device topology from Airthings and syncs it securely.
   */
  public async discoverDevices(): Promise<void> {
    if (this.debugMode) {
      this.log.info('[DEBUG] Starting device discovery phase...');
    }

    const devices = await this.apiClient.getDevices();

    if (!devices || devices.length === 0) {
      this.log.warn('No devices found in this Airthings account.');
      this.cleanupOrphanedAccessories([]);
      return;
    }

    const pluralForm = new Intl.PluralRules('en-US').select(devices.length);
    const deviceWord = pluralForm === 'one' ? 'device' : 'devices';
    this.log.info(`API returned ${devices.length} total ${deviceWord}. Analyzing topology...`);

    for (const device of devices) {
      if (this.shouldIgnoreDevice(device)) {
        continue;
      }

      const uuid = this.api.hap.uuid.generate(device.id);
      let existingAccessory = this.accessories.find(acc => acc.UUID === uuid);

      if (existingAccessory) {
        this.log.info(`Restoring existing accessory: ${existingAccessory.displayName}`);
        existingAccessory.context.device = device;
        this.api.updatePlatformAccessories([existingAccessory]);
      } else {
        const deviceName = device.location?.name ? `${device.location.name} Sensor` : `Airthings ${device.id}`;
        this.log.info(`Adding new accessory: ${deviceName}`);

        existingAccessory = new this.api.platformAccessory(deviceName, uuid);
        existingAccessory.context.device = device;

        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
        this.accessories.push(existingAccessory);
      }

      // Attach logic wrapper
      const wrapper = new AirthingsHubAccessory(this, existingAccessory);
      this.activeWrappers.set(uuid, wrapper);
    }

    this.cleanupOrphanedAccessories(devices);
  }

  private shouldIgnoreDevice(device: AirthingsDevice): boolean {
    if (device.deviceType === DEVICE_TYPE_HUB) {
      if (this.debugMode) {
        this.log.info(`[DEBUG] Filtering out structural HUB device: ${device.id}`);
      }
      return true;
    }

    if (this.config.ignoredDevices.includes(device.id)) {
      this.log.info(`Ignoring device due to config.ignoredDevices filter: ${device.id}`);
      return true;
    }

    if (this.config.includedDevices.length > 0 && !this.config.includedDevices.includes(device.id)) {
      if (this.debugMode) {
        this.log.info(`[DEBUG] Skipping device absent from config.includedDevices: ${device.id}`);
      }
      return true;
    }

    return false;
  }

  private cleanupOrphanedAccessories(activeDevices: ReadonlyArray<import('./types.js').AirthingsDevice>): void {
    const accessoriesToRemove: PlatformAccessory[] = [];
    const orphanGracePeriodMs = this.config.orphanGracePeriodDays * 24 * 60 * 60 * 1000;
    const now = Date.now();

    for (const cachedAccessory of this.accessories) {
      const cachedId = cachedAccessory.context.device.id;
      const upstreamDevice = activeDevices.find(d => d.id === cachedId);

      const shouldRemove = !upstreamDevice || this.shouldIgnoreDevice(cachedAccessory.context.device);

      if (shouldRemove) {
        if (typeof cachedAccessory.context.orphanedSince !== 'number') {
          cachedAccessory.context.orphanedSince = now;
        }

        if (now - cachedAccessory.context.orphanedSince > orphanGracePeriodMs) {
          this.log.info(`Unregistering orphaned accessory: ${cachedAccessory.displayName}`);
          accessoriesToRemove.push(cachedAccessory);
          const wrapper = this.activeWrappers.get(cachedAccessory.UUID);
          if (wrapper) {
            wrapper.stopPolling();
            this.activeWrappers.delete(cachedAccessory.UUID);
          }
        } else {
          // Flag services as unreachable
          for (const service of cachedAccessory.services) {
            if (service.testCharacteristic(this.Characteristic.StatusFault)) {
              service.updateCharacteristic(this.Characteristic.StatusFault, this.Characteristic.StatusFault.GENERAL_FAULT);
            }
          }
        }
      } else {
        delete cachedAccessory.context.orphanedSince;
      }
    }

    if (accessoriesToRemove.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessoriesToRemove);
      // Remove from local cache array
      for (const removed of accessoriesToRemove) {
        const index = this.accessories.indexOf(removed);
        if (index > -1) {
          this.accessories.splice(index, 1);
        }
      }
    }
  }
}

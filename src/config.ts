import { Logger } from 'homebridge';
import { AirthingsHubConfig } from './types.js';

/**
 * Validates and normalizes the incoming Homebridge PlatformConfig.
 * Ensures defaults are applied where missing.
 */
export function parseConfig(config: Partial<AirthingsHubConfig>, log: Logger): AirthingsHubConfig {
  if (!config.clientId || !config.clientSecret) {
    log.error('Missing Client ID or Client Secret. The plugin will not be able to authenticate.');
  }

  // Treat missing sensors array as default: radon + battery
  const sensors = Array.isArray(config.sensors) ? [...config.sensors] : ['radon', 'battery'];

  return {
    platform: config.platform || 'AirthingsHub',
    clientId: config.clientId || '',
    clientSecret: config.clientSecret || '',
    radonThreshold: typeof config.radonThreshold === 'number' ? Math.max(0, config.radonThreshold) : 150,
    radonUnit: config.radonUnit === 'pCi/L' ? 'pCi/L' : 'Bq/m3',
    sensors,
    enableEveCustomCharacteristics: !!config.enableEveCustomCharacteristics,
    orphanGracePeriodDays: typeof config.orphanGracePeriodDays === 'number' ? config.orphanGracePeriodDays : 14,
    ignoredDevices: Array.isArray(config.ignoredDevices) ? [...config.ignoredDevices] : [],
    includedDevices: Array.isArray(config.includedDevices) ? [...config.includedDevices] : [],
    debugMode: !!config.debugMode,
  };
}

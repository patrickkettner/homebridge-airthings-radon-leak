export const PLUGIN_NAME = 'homebridge-airthings-hub';
export const PLATFORM_NAME = 'AirthingsHub';

// Base URLs for Airthings Consumer API
export const AIRTHINGS_API_URL = 'https://ext-api.airthings.com/v1';
export const AIRTHINGS_AUTH_URL = 'https://accounts-api.airthings.com/v1/token';

// Device Types
export const DEVICE_TYPE_HUB = 'HUB';

// Intervals
export const DEFAULT_POLL_INTERVAL_MS = 15 * 60 * 1000;
export const TOKEN_REFRESH_MARGIN_MS = 60 * 1000;

// HTTP Status Codes
export const HTTP_STATUS_OK = 200;
export const HTTP_STATUS_UNAUTHORIZED = 401;
export const HTTP_STATUS_FORBIDDEN = 403;
export const HTTP_STATUS_TOO_MANY_REQUESTS = 429;

// UUIDs for custom characteristics
export const RADON_CHARACTERISTIC_UUID = 'B423235A-3D24-4B4F-8097-90035A0D2F30';

// Thresholds
export const EXCELLENT_VOC_THRESHOLD = 250;
export const GOOD_VOC_THRESHOLD = 500;
export const FAIR_VOC_THRESHOLD = 1000;
export const INFERIOR_VOC_THRESHOLD = 2000;

export const HIGH_CO2_THRESHOLD = 1000;
export const LOW_BATTERY_THRESHOLD = 20;

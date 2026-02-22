import { PlatformConfig } from 'homebridge';

export interface AirthingsHubConfig extends PlatformConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly radonThreshold: number;
  readonly radonUnit: string;
  readonly sensors: ReadonlyArray<string>;
  readonly enableEveCustomCharacteristics: boolean;
  readonly orphanGracePeriodDays: number;
  readonly ignoredDevices: ReadonlyArray<string>;
  readonly includedDevices: ReadonlyArray<string>;
  readonly debugMode: boolean;
}

export interface AirthingsDeviceLocation {
  readonly id: string;
  readonly name: string;
}

export interface AirthingsDeviceSegment {
  readonly id: string;
  readonly name: string;
  readonly started: string;
  readonly active: boolean;
}

export interface AirthingsDevice {
  readonly id: string;
  readonly deviceType: string;
  readonly sensors: ReadonlyArray<string>;
  readonly segment: AirthingsDeviceSegment;
  readonly location: AirthingsDeviceLocation;
}

export interface AirthingsDevicesResponse {
  readonly devices: AirthingsDevice[];
}

export interface AirthingsDeviceSample {
  readonly data: {
    readonly radonShortTermAvg?: number;
    readonly temp?: number;
    readonly humidity?: number;
    readonly pressure?: number;
    readonly co2?: number;
    readonly voc?: number;
    readonly pm1?: number;
    readonly pm25?: number;
    readonly battery?: number;
    readonly [key: string]: number | undefined;
  };
}

export interface AirthingsSensorResponse {
  readonly data: AirthingsDeviceSample['data'];
}

import { AirthingsDeviceSample } from './types.js';

export interface DeviceState {
  latestSample: AirthingsDeviceSample['data'] | null;
  isFaulted: boolean;
}

export function createInitialState(): DeviceState {
  return {
    latestSample: null,
    isFaulted: false,
  };
}

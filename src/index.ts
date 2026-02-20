import { API } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './constants.js';
import { AirthingsHubPlatform } from './platform.js';

export default (api: API): void => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, AirthingsHubPlatform);
};

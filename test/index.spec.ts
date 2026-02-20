import { expect } from 'chai';
import sinon from 'sinon';
import init from '../src/index.js';
import { AirthingsHubPlatform } from '../src/platform.js';
import { PLATFORM_NAME, PLUGIN_NAME } from '../src/constants.js';

describe('Plugin Registration', () => {
  it('registers the platform with Homebridge', () => {
    const mockApi = {
      registerPlatform: sinon.stub()
    };
    
    init(mockApi as any);
    
    expect(mockApi.registerPlatform.calledOnce).to.be.true;
    expect(mockApi.registerPlatform.calledWith(PLUGIN_NAME, PLATFORM_NAME, AirthingsHubPlatform)).to.be.true;
  });
});

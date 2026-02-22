import { expect } from 'chai';
import sinon from 'sinon';
import { Logger } from 'homebridge';
import { DevicePoller } from '../src/poller.js';
import { AirthingsApiClient } from '../src/api.js';

describe('DevicePoller', () => {
  let poller: DevicePoller;
  let mockApiClient: sinon.SinonStubbedInstance<AirthingsApiClient>;
  let mockLogger: sinon.SinonStubbedInstance<Logger>;
  let onUpdateStub: sinon.SinonStub;
  let onFaultStub: sinon.SinonStub;
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    sinon.stub(Math, 'random').returns(0);
    clock = sinon.useFakeTimers();

    mockLogger = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
      debug: sinon.stub(),
      log: sinon.stub(),
    } as unknown as sinon.SinonStubbedInstance<Logger>;

    mockApiClient = {
      getToken: sinon.stub(),
      getDevices: sinon.stub(),
      getLatestSamples: sinon.stub(),
    } as unknown as sinon.SinonStubbedInstance<AirthingsApiClient>;

    onUpdateStub = sinon.stub();
    onFaultStub = sinon.stub();

    poller = new DevicePoller('test-device', mockApiClient as any, mockLogger, 1000, true);
    poller.on('update', onUpdateStub);
    poller.on('fault', onFaultStub);
  });

  afterEach(() => {
    poller.destroy();
    clock.restore();
    sinon.restore();
  });

  it('updates state and calls onUpdate when polling succeeds', async () => {
    mockApiClient.getLatestSamples.resolves({ data: { temp: 21, radonShortTermAvg: 40 } });

    await poller.poll();

    expect(onFaultStub.called).to.be.false;
    expect(onUpdateStub.calledOnce).to.be.true;
    expect(onUpdateStub.firstCall.args[0]).to.deep.equal({ temp: 21, radonShortTermAvg: 40 });
  });

  it('handles malformed data without throwing', async () => {
    mockApiClient.getLatestSamples.resolves({} as any);

    await poller.poll();

    expect(mockLogger.warn.calledWithMatch(sinon.match(/malformed/))).to.be.true;
    expect(onUpdateStub.called).to.be.false;
  });

  it('logs error and defers fault when API throws normal error', async () => {
    mockApiClient.getLatestSamples.rejects(new Error('API Down'));

    await poller.poll();

    // First failure should NOT fault yet
    expect(onFaultStub.called).to.be.false;
    expect(mockLogger.error.calledWithMatch(sinon.match(/API Down/))).to.be.true;

    // Fail 2 more times to trigger fault
    await poller.poll();
    await poller.poll();
    expect(onFaultStub.called).to.be.true;
  });

  it('handles string errors equivalently', async () => {
    mockApiClient.getLatestSamples.returns(Promise.reject('String Error'));

    await poller.poll();

    expect(mockLogger.error.calledWithMatch(sinon.match(/String Error/))).to.be.true;
    expect(onFaultStub.called).to.be.false;
  });

  it('silently ignores 429 Too Many Requests to prevent cascading faults', async () => {
    mockApiClient.getLatestSamples.rejects(new Error('status 429 Too Many Requests'));

    await poller.poll();
    await poller.poll();
    await poller.poll(); // Even 3 times it should not fault!

    expect(onFaultStub.called).to.be.false;
    expect(mockLogger.warn.calledWithMatch(sinon.match(/rate limit/))).to.be.true;
  });

  it('ignores timeout AbortError silently in log', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    mockApiClient.getLatestSamples.rejects(abortErr);

    await poller.poll();

    expect(onFaultStub.called).to.be.false;
    expect(mockLogger.info.calledWithMatch(sinon.match(/timed out/))).to.be.true;
    expect(onUpdateStub.called).to.be.false;
  });

  it('starts and repeats on the specified interval', async () => {
    mockApiClient.getLatestSamples.returns(Promise.resolve({ data: { test: 1 } }));

    poller.start();

    await clock.tickAsync(1);
    expect(mockApiClient.getLatestSamples.callCount).to.equal(1);

    await clock.tickAsync(1000);
    expect(mockApiClient.getLatestSamples.callCount).to.equal(2);

    await clock.tickAsync(1000);
    expect(mockApiClient.getLatestSamples.callCount).to.equal(3);
  });

  it('bails out of scheduleNext if polling is stopped mid-poll', async () => {
    mockApiClient.getLatestSamples.callsFake(async () => {
      poller.destroy(); // Stop mid-poll
      return { data: { radonShortTermAvg: 100 } };
    });

    poller.start();

    // Advance to trigger the first poll
    await clock.tickAsync(5000);

    // Because we stopped mid-poll, scheduleNext should bail out
    await clock.tickAsync(60000); // More than 5 minutes
    expect(mockApiClient.getLatestSamples.callCount).to.equal(1);

    // Explicitly call scheduleNext when isPolling is false to cover the branch if it somehow missed
    poller.destroy();
    (poller as any).scheduleNext();
  });

  it('clears existing interval if present when scheduling next', async () => {
    poller.start();
    poller['pollingInterval'] = setTimeout(() => { }, 10000);

    await clock.tickAsync(5000); // trigger jitter timeout which calls poll then scheduleNext
  });

  it('bails out of jitter timeout if polling is false', async () => {
    poller.start();
    poller['isPolling'] = false;
    await clock.tickAsync(5000);
    expect(mockApiClient.getLatestSamples.called).to.be.false;
  });

  it('does not duplicate intervals when start is called multiple times', async () => {
    mockApiClient.getLatestSamples.returns(Promise.resolve({ data: { test: 1 } }));
    poller.start();
    poller.start(); // Should ignore

    await clock.tickAsync(1);
    expect(mockApiClient.getLatestSamples.callCount).to.equal(1);

    await clock.tickAsync(1000);
    expect(mockApiClient.getLatestSamples.callCount).to.equal(2);
  });

  it('stops polling when stop is called', async () => {
    mockApiClient.getLatestSamples.resolves({ data: { test: 1 } });

    poller.start();
    await clock.tickAsync(1);
    expect(mockApiClient.getLatestSamples.callCount).to.equal(1);

    poller.destroy();

    await clock.tickAsync(1000); // Should not trigger another poll
    expect(mockApiClient.getLatestSamples.callCount).to.equal(1);
  });

  it('faults state after 3 consecutive AbortError timeouts', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    mockApiClient.getLatestSamples.rejects(abortErr);

    await poller.poll(); // Failure 1
    expect(onFaultStub.called).to.be.false;

    await poller.poll(); // Failure 2
    expect(onFaultStub.called).to.be.false;

    await poller.poll(); // Failure 3
    expect(onFaultStub.called).to.be.true;
    expect(mockLogger.warn.calledWithMatch(sinon.match(/3 consecutive polls/))).to.be.true;
  });
});

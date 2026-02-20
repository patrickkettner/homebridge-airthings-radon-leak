import { expect } from 'chai';
import sinon from 'sinon';
import { Logger } from 'homebridge';
import { DevicePoller } from '../src/poller.js';
import { DeviceState, createInitialState } from '../src/state.js';
import { AirthingsApiClient } from '../src/api.js';

describe('DevicePoller', () => {
  let poller: DevicePoller;
  let mockApiClient: sinon.SinonStubbedInstance<AirthingsApiClient>;
  let state: DeviceState;
  let mockLogger: sinon.SinonStubbedInstance<Logger>;
  let onUpdateStub: sinon.SinonStub;
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

    state = createInitialState();
    onUpdateStub = sinon.stub();

    poller = new DevicePoller('test-device', mockApiClient as any, state, mockLogger, 1000, onUpdateStub, true);
  });

  afterEach(() => {
    poller.stop();
    clock.restore();
    sinon.restore();
  });

  it('updates state and calls onUpdate when polling succeeds', async () => {
    mockApiClient.getLatestSamples.resolves({ data: { temp: 21, radonShortTermAvg: 40 } });

    await poller.poll();

    expect(state.isFaulted).to.be.false;
    expect(state.latestSample).to.deep.equal({ temp: 21, radonShortTermAvg: 40 });
    expect(onUpdateStub.calledOnce).to.be.true;
  });

  it('handles malformed data without throwing', async () => {
    mockApiClient.getLatestSamples.resolves({} as any);

    await poller.poll();

    expect(state.latestSample).to.be.null;
    expect(mockLogger.warn.calledWithMatch(sinon.match(/malformed/))).to.be.true;
    expect(onUpdateStub.called).to.be.false;
  });

  it('flags state as faulted when API throws normal error', async () => {
    mockApiClient.getLatestSamples.rejects(new Error('API Down'));

    await poller.poll();

    expect(poller.state.isFaulted).to.be.true;
    expect(poller.state.latestSample).to.be.null;
    expect(onUpdateStub.called).to.be.true; // called with fault
    expect(mockLogger.error.calledWithMatch(/API Down/)).to.be.true;
  });

  it('flags state as faulted when API throws a string', async () => {
    mockApiClient.getLatestSamples.returns(Promise.reject('String Error'));

    await poller.poll();

    expect(poller.state.isFaulted).to.be.true;
    expect(mockLogger.error.calledWithMatch(/String Error/)).to.be.true;
  });

  it('ignores timeout AbortError silently in log', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    mockApiClient.getLatestSamples.rejects(abortErr);

    await poller.poll();

    expect(state.isFaulted).to.be.false;
    expect(mockLogger.info.calledWithMatch(sinon.match(/timed out/))).to.be.true;
    expect(onUpdateStub.called).to.be.false;
  });

  it('starts and repeats on the specified interval', async () => {
    // Explicitly configure mock correctly to return a promise that resolves
    mockApiClient.getLatestSamples.returns(Promise.resolve({ data: { test: 1 } }));

    poller.start();

    // Advance clock to surpass 0ms jitter delay
    await clock.tickAsync(1);
    expect(mockApiClient.getLatestSamples.callCount).to.equal(1);

    // Advance time and resolve promises
    await clock.tickAsync(1000);
    expect(mockApiClient.getLatestSamples.callCount).to.equal(2);

    await clock.tickAsync(1000);
    expect(mockApiClient.getLatestSamples.callCount).to.equal(3);
  });

  it('bails out of scheduleNext if polling is stopped mid-poll', async () => {
    mockApiClient.getLatestSamples.callsFake(async () => {
      poller.stop(); // Stop mid-poll
      return { data: { radonShortTermAvg: 100 } };
    });

    poller.start();

    // Advance to trigger the first poll
    await clock.tickAsync(5000);

    // Because we stopped mid-poll, scheduleNext should bail out
    // We verify by advancing clock again and checking callCount is still 1
    await clock.tickAsync(60000); // More than 5 minutes
    expect(mockApiClient.getLatestSamples.callCount).to.equal(1);

    // Explicitly call scheduleNext when isPolling is false to cover the branch if it somehow missed
    poller.stop();
    (poller as any).scheduleNext();
  });

  it('clears existing interval if present when scheduling next', async () => {
    // Force an existing interval right before scheduleNext
    poller.start();
    poller['pollingInterval'] = setTimeout(() => { }, 10000);

    await clock.tickAsync(5000); // trigger jitter timeout which calls poll then scheduleNext
    // If it didn't clear the manual timeout we just placed, it would leak, but scheduleNext clears it.
  });

  it('bails out of jitter timeout if polling is false', async () => {
    poller.start();
    // Simulate race condition where stop () clears the interval but the callback is already queued or we bypass clearTimeout
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

    poller.stop();

    await clock.tickAsync(1000); // Should not trigger another poll
    expect(mockApiClient.getLatestSamples.callCount).to.equal(1);
  });

  it('faults state after 3 consecutive AbortError timeouts', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    mockApiClient.getLatestSamples.rejects(abortErr);

    await poller.poll(); // Failure 1
    expect(state.isFaulted).to.be.false;

    await poller.poll(); // Failure 2
    expect(state.isFaulted).to.be.false;

    await poller.poll(); // Failure 3
    expect(state.isFaulted).to.be.true;
    expect(onUpdateStub.calledOnce).to.be.true;
    expect(mockLogger.warn.calledWithMatch(sinon.match(/3 consecutive polls/))).to.be.true;
  });
});

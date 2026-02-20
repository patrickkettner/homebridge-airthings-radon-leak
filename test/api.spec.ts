import { expect } from 'chai';
import sinon from 'sinon';
import { Logger } from 'homebridge';
import { AirthingsApiClient } from '../src/api.js';

describe('AirthingsApiClient', () => {
  let apiClient: AirthingsApiClient;
  let mockLogger: sinon.SinonStubbedInstance<Logger>;
  let globalFetchStub: sinon.SinonStub;

  beforeEach(() => {
    mockLogger = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
      debug: sinon.stub(),
      log: sinon.stub(),
    } as unknown as sinon.SinonStubbedInstance<Logger>;

    globalFetchStub = sinon.stub(globalThis, 'fetch');
    apiClient = new AirthingsApiClient('my-client-id', 'my-client-secret', mockLogger, true);
  });

  afterEach(() => {
    sinon.restore();
  });

  function createMockResponse(status: number, ok: boolean, body: any): Promise<Response> {
    return Promise.resolve({
      status,
      ok,
      statusText: ok ? 'OK' : 'Error',
      json: () => Promise.resolve(body),
    } as unknown as Response);
  }

  describe('Authentication', () => {
    it('authenticates and caches the token', async () => {
      globalFetchStub.resolves(createMockResponse(200, true, { access_token: 'valid-token', expires_in: 3600 }));

      const token1 = await apiClient.getToken();
      expect(token1).to.equal('valid-token');
      expect(globalFetchStub.callCount).to.equal(1);

      // Subsequent call should use cache
      const token2 = await apiClient.getToken();
      expect(token2).to.equal('valid-token');
      expect(globalFetchStub.callCount).to.equal(1); // Still 1
    });

    it('refreshes the token if expired', async () => {
      globalFetchStub.onFirstCall().resolves(createMockResponse(200, true, { access_token: 'token1', expires_in: 0 }));
      globalFetchStub.onSecondCall().resolves(createMockResponse(200, true, { access_token: 'token2', expires_in: 3600 }));

      const token1 = await apiClient.getToken();
      expect(token1).to.equal('token1');

      // We explicitly simulated expiration with expires_in=0, which sets expiration time to past
      const token2 = await apiClient.getToken();
      expect(token2).to.equal('token2');
      expect(globalFetchStub.callCount).to.equal(2);
    });

    it('logs error and throws on auth failure', async () => {
      globalFetchStub.resolves(createMockResponse(400, false, {}));
      const err = await apiClient.getToken().catch(e => e);
      expect(err).to.be.an('error');
      expect(err.message).to.include('Auth failed with status 400');
      expect(mockLogger.error.calledWithMatch(sinon.match(/Failed to authenticate/))).to.be.true;
    });

    it('coalesces concurrent token refresh requests', async () => {
      globalFetchStub.callsFake(async () => {
        // Add artificial delay to ensure promises overlap
        await new Promise(resolve => setTimeout(resolve, 50));
        return createMockResponse(200, true, { access_token: 'slow-token', expires_in: 3600 });
      });

      const p1 = apiClient.getToken();
      const p2 = apiClient.getToken();

      const [t1, t2] = await Promise.all([p1, p2]);

      expect(t1).to.equal('slow-token');
      expect(t2).to.equal('slow-token');
      expect(globalFetchStub.callCount).to.equal(1);
    });
  });

  describe('API Requests', () => {
    beforeEach(() => {
      // Pre-seed a valid token to skip auth requests for most tests
      globalFetchStub.onFirstCall().resolves(createMockResponse(200, true, { access_token: 'valid-token', expires_in: 3600 }));
    });

    it('fetches devices successfully', async () => {
      globalFetchStub.onSecondCall().resolves(createMockResponse(200, true, { devices: [{ id: '123' }] }));

      const devices = await apiClient.getDevices();
      expect(devices).to.deep.equal([{ id: '123' }]);
      expect(globalFetchStub.callCount).to.equal(2);
    });

    it('returns empty array if devices is nullish or omitted', async () => {
      globalFetchStub.onSecondCall().resolves(createMockResponse(200, true, {}));

      const devices = await apiClient.getDevices();
      expect(devices).to.deep.equal([]);
    });

    it('fetches exact sensors successfully', async () => {
      globalFetchStub.onSecondCall().resolves(createMockResponse(200, true, { data: { radonShortTermAvg: 42 } }));

      const samples = await apiClient.getLatestSamples('device-id');
      expect(samples.data.radonShortTermAvg).to.equal(42);
    });

    it('transparently retries on 401 Unauthorized', async () => {
      // First API request returns 401
      globalFetchStub.onSecondCall().resolves(createMockResponse(401, false, {}));

      // Since it retries, it clears cache and fetches new token (Third call)
      globalFetchStub.onThirdCall().resolves(createMockResponse(200, true, { access_token: 'token2', expires_in: 3600 }));

      // Fourth call is the retried API request
      globalFetchStub.onCall(3).resolves(createMockResponse(200, true, { devices: [{ id: 'retried' }] }));

      const devices = await apiClient.getDevices();
      expect(devices).to.deep.equal([{ id: 'retried' }]);
      expect(globalFetchStub.callCount).to.equal(4);
      expect(mockLogger.info.calledWithMatch(sinon.match(/Token rejected/))).to.be.true;
    });

    it('throws explicitly on 403 Forbidden', async () => {
      globalFetchStub.onSecondCall().resolves(createMockResponse(403, false, {}));
      const err = await apiClient.getDevices().catch(e => e);
      expect(err).to.be.an('error');
      expect(err.message).to.include('403 Forbidden');
      expect(mockLogger.error.calledWithMatch(sinon.match(/API Request failed/))).to.be.true;
    });

    it('throws on standard API failure', async () => {
      globalFetchStub.onSecondCall().resolves(createMockResponse(500, false, {}));
      const err = await apiClient.getDevices().catch(e => e);
      expect(err).to.be.an('error');
      expect(err.message).to.include('status 500');
      expect(mockLogger.error.calledWithMatch(sinon.match(/API Request failed/))).to.be.true;
    });

    it('throws on network/fetch abort', async () => {
      globalFetchStub.onSecondCall().rejects(new Error('Network Error'));
      const err = await apiClient.getDevices().catch(e => e);
      expect(err).to.be.an('error');
      expect(err.message).to.include('Network Error');
      expect(mockLogger.error.calledWithMatch(sinon.match(/API Request failed/))).to.be.true;
    });
  });

  describe('fetchWithTimeout edge cases', () => {
    it('aborts fetch if taking longer than 10 seconds', async () => {
      const clock = sinon.useFakeTimers();

      globalFetchStub.callsFake(async (url, init: RequestInit) => {
        // We simulate a fetch that never resolves on its own
        return new Promise((resolve, reject) => {
          if (init.signal) {
            init.signal.addEventListener('abort', () => {
              reject(new Error('The operation was aborted'));
            });
          }
        });
      });

      const reqPromise = apiClient.getToken();

      clock.tick(10000); // Trigger timeout
      const err = await reqPromise.catch(e => e);
      expect(err).to.be.an('error');
      expect(err.message).to.include('aborted');
      clock.restore();
    });
  });
});

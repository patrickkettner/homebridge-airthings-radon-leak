import { Logger } from 'homebridge';
import { AirthingsApiClient } from './api.js';
import { DeviceState } from './state.js';

/**
 * Encapsulates the periodic fetching logic.
 * Updates the provided state object and triggers a callback on change.
 */
export class DevicePoller {
  private pollingInterval: NodeJS.Timeout | null = null;
  private isPolling = false;
  private consecutiveFailures = 0;

  constructor(
    private readonly deviceId: string,
    private readonly apiClient: AirthingsApiClient,
    private readonly state: DeviceState,
    private readonly log: Logger,
    private readonly pollIntervalMs: number,
    private readonly onUpdate: () => void,
    private readonly debugMode: boolean,
  ) { }

  public start(): void {
    if (this.isPolling) {
      return;
    }
    this.isPolling = true;

    // Add jitter to desync HTTP requests on boot
    const jitter = Math.floor(Math.random() * 5000);
    this.pollingInterval = setTimeout(() => {
      if (!this.isPolling) return;
      this.poll().finally(() => {
        this.scheduleNext();
      });
    }, jitter);
  }

  public stop(): void {
    this.isPolling = false;
    if (this.pollingInterval) {
      clearTimeout(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private scheduleNext(): void {
    if (!this.isPolling) {
      return;
    }
    if (this.pollingInterval) {
      clearTimeout(this.pollingInterval);
    }
    this.pollingInterval = setTimeout(() => {
      this.poll().finally(() => {
        this.scheduleNext();
      });
    }, this.pollIntervalMs);
  }

  /**
   * Fetches the latest sample and updates state directly.
   * Does not throw; handles errors internally.
   */
  public async poll(): Promise<void> {
    try {
      if (this.debugMode) {
        this.log.info(`[DEBUG] Polling data for ${this.deviceId}...`);
      }

      const sample = await this.apiClient.getLatestSamples(this.deviceId);

      if (!sample || !sample.data || Object.keys(sample.data).length === 0) {
        this.log.warn(`API returned malformed or empty data for device ${this.deviceId}.`);
        this.handleConsecutiveFailure();
        return;
      }

      if (this.debugMode) {
        this.log.info(`[DEBUG] Raw sample data for ${this.deviceId}: ${JSON.stringify(sample.data)}`);
      }

      this.state.latestSample = sample.data;
      this.state.isFaulted = false;
      this.consecutiveFailures = 0;
      this.onUpdate();

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        if (this.debugMode) {
          this.log.info(`[DEBUG] Poll request for ${this.deviceId} timed out. Will retry next cycle.`);
        }
        this.handleConsecutiveFailure();
        return;
      }

      const errMessage = error instanceof Error ? error.message : String(error);
      this.log.error(`Failed to poll ${this.deviceId}: ${errMessage}`);

      this.state.isFaulted = true;
      this.consecutiveFailures = 0;
      this.onUpdate();
    }
  }

  private handleConsecutiveFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= 3) {
      if (!this.state.isFaulted) {
        this.log.warn(`Device ${this.deviceId} failed 3 consecutive polls. Marking as faulted.`);
      }
      this.state.isFaulted = true;
      this.onUpdate();
    }
  }
}

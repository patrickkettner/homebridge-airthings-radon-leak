import { Logger } from 'homebridge';
import { EventEmitter } from 'events';
import { AirthingsApiClient } from './api.js';

export interface PollerEvents {
  'update': (data: any) => void;
  'fault': (errMessage: string) => void;
}

export declare interface DevicePoller {
  on<U extends keyof PollerEvents>(event: U, listener: PollerEvents[U]): this;
  emit<U extends keyof PollerEvents>(event: U, ...args: Parameters<PollerEvents[U]>): boolean;
}

export class DevicePoller extends EventEmitter {
  private pollingInterval: NodeJS.Timeout | null = null;
  private isPolling = false;
  private consecutiveFailures = 0;

  constructor(
    private readonly deviceId: string,
    private readonly apiClient: AirthingsApiClient,
    private readonly log: Logger,
    private readonly pollIntervalMs: number,
    private readonly debugMode: boolean,
  ) {
    super();
  }

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

  public destroy(): void {
    this.isPolling = false;
    if (this.pollingInterval) {
      clearTimeout(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.removeAllListeners();
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

  public async poll(): Promise<void> {
    try {
      if (this.debugMode) {
        this.log.info(`[DEBUG] Polling data for ${this.deviceId}...`);
      }

      const sample = await this.apiClient.getLatestSamples(this.deviceId);

      if (!sample || !sample.data || Object.keys(sample.data).length === 0) {
        this.log.warn(`API returned malformed or empty data for device ${this.deviceId}.`);
        this.handleConsecutiveFailure("Malformed or empty response payload");
        return;
      }

      if (this.debugMode) {
        this.log.info(`[DEBUG] Raw sample data for ${this.deviceId}: ${JSON.stringify(sample.data)}`);
      }

      this.consecutiveFailures = 0;
      this.emit('update', sample.data);

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        if (this.debugMode) {
          this.log.info(`[DEBUG] Poll request for ${this.deviceId} timed out. Will retry next cycle.`);
        }
        this.handleConsecutiveFailure("Request timeout");
        return;
      }

      const errMessage = error instanceof Error ? error.message : String(error);

      if (errMessage.includes('status 429')) {
        this.log.warn(`Airthings API rate limit reached (429) for ${this.deviceId}. Delaying next poll.`);
        return;
      }

      this.log.error(`Failed to poll ${this.deviceId}: ${errMessage}`);
      this.handleConsecutiveFailure(errMessage);
    }
  }

  private handleConsecutiveFailure(reason: string): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= 3) {
      const msg = `Device ${this.deviceId} failed 3 consecutive polls (Reason: ${reason}). Check internet connection. Marking as faulted.`;
      if (this.consecutiveFailures === 3) {
        this.log.warn(msg);
      }
      this.emit('fault', msg);
    }
  }
}

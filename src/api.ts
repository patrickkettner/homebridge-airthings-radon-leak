import { Logger } from 'homebridge';
import {
  AIRTHINGS_API_URL,
  AIRTHINGS_AUTH_URL,
  HTTP_STATUS_FORBIDDEN,
  HTTP_STATUS_UNAUTHORIZED,
  TOKEN_REFRESH_MARGIN_MS,
} from './constants.js';
import { AirthingsDevice, AirthingsSensorResponse, AirthingsDevicesResponse } from './types.js';

interface OAuthResponse {
  readonly access_token: string;
  readonly expires_in: number;
}

export class AirthingsApiClient {
  private accessToken: string | null = null;
  private tokenExpirationTime = 0;
  private tokenRefreshPromise: Promise<string> | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly log: Logger,
    private readonly debugMode: boolean,
  ) { }

  /**
   * Retrieves an active OAuth token, fetching a new one if necessary.
   * Debounces concurrent refresh requests.
   */
  public async getToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpirationTime) {
      return this.accessToken;
    }

    if (this.tokenRefreshPromise) {
      return this.tokenRefreshPromise;
    }

    this.tokenRefreshPromise = this.fetchNewToken().finally(() => {
      this.tokenRefreshPromise = null;
    });

    return this.tokenRefreshPromise;
  }

  private async fetchNewToken(): Promise<string> {
    if (this.debugMode) {
      this.log.info('[DEBUG] Fetching new Airthings auth token...');
    }

    try {
      const response = await this.fetchWithTimeout(AIRTHINGS_AUTH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret,
        }),
      });

      if (!response.ok) {
        throw new Error(`Auth failed with status ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as OAuthResponse;
      this.accessToken = data.access_token;

      // Expire token slightly early to ensure it doesn't expire mid-flight
      this.tokenExpirationTime = Math.max(Date.now(), Date.now() + (data.expires_in * 1000) - TOKEN_REFRESH_MARGIN_MS);

      if (this.debugMode) {
        this.log.info('[DEBUG] Successfully retrieved new auth token.');
      }

      return this.accessToken;
    } catch (error) {
      this.log.error('Failed to authenticate with Airthings API. Check Client ID and Secret.');
      this.accessToken = null;
      this.tokenExpirationTime = 0;
      throw error;
    }
  }

  /**
   * Native fetch wrapper with a strictly enforced 10-second timeout.
   */
  private async fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Performs an authenticated GET request to the given endpoint.
   * On 401 Unauthorized, automatically clears token and retries exactly once.
   */
  private async request<T>(endpoint: string, isRetry = false): Promise<T> {
    const token = await this.getToken();
    const url = `${AIRTHINGS_API_URL}${endpoint}`;

    try {
      const response = await this.fetchWithTimeout(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
        },
      });

      if (response.ok) {
        return await response.json() as T;
      }

      if (response.status === HTTP_STATUS_UNAUTHORIZED && !isRetry) {
        if (this.debugMode) {
          this.log.info('[DEBUG] Token rejected (401), clearing and retrying...');
        }
        this.accessToken = null;
        this.tokenExpirationTime = 0;
        return await this.request<T>(endpoint, true);
      }

      if (response.status === HTTP_STATUS_FORBIDDEN) {
        throw new Error(`API returned 403 Forbidden. Ensure your API client has necessary scopes for ${endpoint}`);
      }

      throw new Error(`API request failed with status ${response.status}: ${response.statusText}`);
    } catch (error) {
      this.log.error(`API Request failed for endpoint ${endpoint}`);
      throw error;
    }
  }

  public async getDevices(): Promise<ReadonlyArray<AirthingsDevice>> {
    if (this.debugMode) {
      this.log.info('[DEBUG] Fetching Airthings devices...');
    }
    const response = await this.request<AirthingsDevicesResponse>('/devices');
    return response.devices || [];
  }

  public async getLatestSamples(deviceId: string): Promise<AirthingsSensorResponse> {
    if (this.debugMode) {
      this.log.info(`[DEBUG] Fetching latest samples for device ${deviceId}...`);
    }
    return this.request<AirthingsSensorResponse>(`/devices/${deviceId}/latest-samples`);
  }
}

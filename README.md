# Homebridge Airthings Hub

<p align="center">
  <img src="https://raw.githubusercontent.com/homebridge/branding/master/logos/homebridge-wordmark-logo-vertical.png" width="150" alt="Homebridge">
</p>

A Homebridge plugin that brings your Airthings devices into Apple HomeKit via the Airthings Consumer Hub API (Cloud).

## Features

- **Sensors Supported:** Radon, CO2, VOC, Temperature, Humidity, and Battery.
- **Eve App Support:** View historical graphs for your Radon levels natively in the Eve app!
- **Dynamic Configuration:** You can select precisely which sensors to expose, to avoid clutter in your Home app.
- **Robust Reliability:** Transparently handles token refreshes, handles API jitter, and keeps your HomeKit environment functioning.
- **Orphan Grace Period:** Handles unreachable devices gracefully. Devices that go offline will not be immediately deleted from HomeKit, preserving your automations for a configurable grace period.

## Prerequisites

To use this plugin, you must have an **Airthings API Client**.

1. Go to your [Airthings Dashboard Access Control](https://dashboard.airthings.com/access-control-client) page.
2. Click **New API Client**.
3. Give it a name (e.g., "Homebridge") and click **Save**.
4. Note your **Client ID** and **Client Secret**. (They will only be shown once!).

## Configuration

The easiest way to configure the plugin is through [Homebridge Config UI X](https://github.com/oznu/homebridge-config-ui-x).

If you are configuring manually, add the following to your `config.json` inside the `platforms` array:

```json
{
  "platform": "AirthingsHub",
  "name": "Airthings",
  "clientId": "YOUR_CLIENT_ID",
  "clientSecret": "YOUR_CLIENT_SECRET",
  "radonThreshold": 150,
  "radonUnit": "Bq/m3",
  "sensors": ["radon", "battery"],
  "enableEveCustomCharacteristics": false,
  "orphanGracePeriodDays": 14
}
```

### Configuration Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `platform` | string | Yes | `AirthingsHub` | Must strictly be `AirthingsHub`. |
| `name` | string | No | `Airthings` | The name of the platform. |
| `clientId` | string | Yes | | The Client ID from your Airthings dashboard. |
| `clientSecret` | string | Yes | | The Client Secret from your Airthings dashboard. |
| `radonThreshold` | number | No | `150` | The Radon level at which a Leak sensor is triggered in HomeKit. Evaluated against the raw Bq/m3 API value (150 Bq/m3 ≈ 4.0 pCi/L). |
| `radonUnit` | string | No | `Bq/m3` | (Presentation Only) Select `Bq/m3` or `pCi/L` for displaying Radon levels in apps that support custom characteristics (like Eve). |
| `sensors` | array | No | `["radon", "battery"]` | An array of sensors to expose to HomeKit. Valid options include: `radon`, `co2`, `voc`, `temp`, `humidity`, `battery`. |
| `enableEveCustomCharacteristics` | boolean | No | `false` | Enable to expose the exact raw Radon Level as a custom characteristic viewable in the Eve app. |
| `orphanGracePeriodDays` | number | No | `14` | Days to retain offline accessories before removing them from your Homebridge cache. |
| `ignoredDevices` | array | No | `[]` | List of device IDs (serial numbers) to ignore. |
| `includedDevices` | array | No | `[]` | List of device IDs to strictly include. If populated, devices not in this list will be ignored. |
| `debugMode` | boolean | No | `false` | Enables verbose HTTP tracing and diagnostics. |

## Tested Devices
- Airthings View Plus
- Airthings Wave Plus
- Airthings Wave Radon

*Note: The Airthings Hub is required to expose BLE devices to the Airthings Cloud.*

## Troubleshooting

### Eve App Custom Characteristics Not Showing Up
If you enable Eve App custom characteristics but they do not appear in the Eve App:
1. Ensure the `enableEveCustomCharacteristics` option is checked in your config.
2. Force close the Eve app.
3. If they still do not appear, you may need to clear your Homebridge accessory cache, as HomeKit firmly caches characteristic UUIDs upon initial pairing.

### "No Response" or "API Rate Limit" Warnings
The Airthings API strictly enforces rate limits. The plugin employs caching, backoff, and startup jitter to avoid hitting these. 
If you see rate limit errors in your logs, ensure you are not running multiple Homebridge instances against the same API client, or polling heavily with external tools concurrently.

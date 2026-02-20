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
  "sensors": ["radon", "battery"],
  "enableEveCustomCharacteristics": false,
  "orphanGracePeriodDays": 365
}
```

### Configuration Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `platform` | string | Yes | `AirthingsHub` | Must strictly be `AirthingsHub`. |
| `name` | string | No | `Airthings` | The name of the platform. |
| `clientId` | string | Yes | | The Client ID from your Airthings dashboard. |
| `clientSecret` | string | Yes | | The Client Secret from your Airthings dashboard. |
| `radonThreshold` | number | No | `150` | The Radon level (in Bq/m³) at which a Leak sensor is triggered in HomeKit. According to the WHO, the actionable limit is usually 100-150 Bq/m³. |
| `sensors` | array | No | `["radon", "battery"]` | An array of sensors to expose to HomeKit. Valid options include: `radon`, `co2`, `voc`, `temp`, `humidity`, `battery`. |
| `enableEveCustomCharacteristics` | boolean | No | `false` | Enable to expose the exact raw Radon Level (in Bq/m³) as a custom characteristic viewable in the Eve app. |
| `orphanGracePeriodDays` | number | No | `365` | Days to retain offline accessories before removing them from your Homebridge cache. |
| `ignoredDevices` | array | No | `[]` | List of device IDs (serial numbers) to ignore. |
| `includedDevices` | array | No | `[]` | List of device IDs to strictly include. If populated, devices not in this list will be ignored. |
| `debugMode` | boolean | No | `false` | Enables verbose HTTP tracing and diagnostics. |

## Tested Devices
- Airthings View Plus
- Airthings Wave Plus
- Airthings Wave Radon

*Note: The Airthings Hub is required to expose BLE devices to the Airthings Cloud.*

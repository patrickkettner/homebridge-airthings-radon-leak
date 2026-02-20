# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-02-20

### Added
- Initial stable release.
- Support for Airthings View Plus, Wave Mini, Wave Plus, and Wave Radon devices.
- Dynamic exposure of Radon, CO2, VOC, Temperature, Humidity, and Battery sensors based on device capabilities.
- Configurable Radon Threshold (default: 150 Bq/m³) for triggering HomeKit Leak Sensors.
- Eve App integration for exposing exact numerical Radon values as a custom characteristic history.
- Device whitelisting (`includedDevices`) and blacklisting (`ignoredDevices`) configuration options.
- Orphan management with a configurable `orphanGracePeriodDays` (default: 365 days) to retain offline devices.
- Comprehensive unit testing suite.
- Native HomeKit and Homebridge UI X compatibility.

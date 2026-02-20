(async () => {
  try {
    const pluginConfigArr = await window.homebridge.getPluginConfig();
    const config = pluginConfigArr.length ? pluginConfigArr[0] : {
      platform: 'AirthingsHub',
      name: 'Airthings',
      radonThreshold: 150,
      sensors: ['radon', 'battery'],
      enableEveCustomCharacteristics: false,
      debugMode: false,
    };

    // Populate Fields
    document.getElementById('nameInput').value = config.name || '';
    document.getElementById('clientIdInput').value = config.clientId || '';
    document.getElementById('clientSecretInput').value = config.clientSecret || '';
    document.getElementById('radonThresholdInput').value = config.radonThreshold || 150;
    document.getElementById('eveUiInput').checked = !!config.enableEveCustomCharacteristics;
    document.getElementById('debugModeInput').checked = !!config.debugMode;

    if (config.ignoredDevices && Array.isArray(config.ignoredDevices)) {
      document.getElementById('ignoredDevicesInput').value = config.ignoredDevices.join(', ');
    }
    if (config.includedDevices && Array.isArray(config.includedDevices)) {
      document.getElementById('includedDevicesInput').value = config.includedDevices.join(', ');
    }

    const sensorsSet = new Set(config.sensors || []);
    const checkboxes = document.querySelectorAll('#sensorsContainer input[type="checkbox"]');
    checkboxes.forEach(cb => {
      if (sensorsSet.has(cb.value)) cb.checked = true;
    });

    window.homebridge.disableSaveButton();

    const handleSave = async () => {
      const name = document.getElementById('nameInput').value;
      const clientId = document.getElementById('clientIdInput').value;
      const clientSecret = document.getElementById('clientSecretInput').value;

      if (!clientId || !clientSecret) {
        window.homebridge.toast.error('Client ID and Secret are required.');
        return false;
      }

      const updatedSensors = [];
      checkboxes.forEach(cb => {
        if (cb.checked) updatedSensors.push(cb.value);
      });

      const ignoredDeviceVal = document.getElementById('ignoredDevicesInput').value;
      const ignoredDevices = ignoredDeviceVal ? ignoredDeviceVal.split(',').map(s => s.trim()).filter(s => s) : [];

      const includedDeviceVal = document.getElementById('includedDevicesInput').value;
      const includedDevices = includedDeviceVal ? includedDeviceVal.split(',').map(s => s.trim()).filter(s => s) : [];

      const updatedConfig = {
        platform: 'AirthingsHub',
        name,
        clientId,
        clientSecret,
        radonThreshold: parseInt(document.getElementById('radonThresholdInput').value, 10) || 150,
        sensors: updatedSensors,
        enableEveCustomCharacteristics: document.getElementById('eveUiInput').checked,
        ignoredDevices,
        includedDevices,
        debugMode: document.getElementById('debugModeInput').checked
      };

      try {
        await window.homebridge.updatePluginConfig([updatedConfig]);
        await window.homebridge.savePluginConfig();
        window.homebridge.toast.success('Configuration Saved');
        return true;
      } catch (err) {
        window.homebridge.toast.error('Failed to save config.');
        return false;
      }
    };

    window.homebridge.addEventListener('submit', handleSave);
    document.getElementById('save-button').addEventListener('click', handleSave);

  } catch (error) {
    console.error('Error initializing Homebridge UI:', error);
  }
})();

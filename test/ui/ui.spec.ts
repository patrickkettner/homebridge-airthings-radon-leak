import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Homebridge Custom UI Functionality & Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    // Inject a mock homebridge API before the page loads app.js
    await page.addInitScript(() => {
      (window as any).homebridge = {
        getPluginConfig: async () => {
          return [{
            platform: 'AirthingsHub',
            name: 'Airthings',
            radonThreshold: 200,
            sensors: ['radon', 'temp'],
            enableEveCustomCharacteristics: true,
            debugMode: true
          }];
        },
        updatePluginConfig: async (config: any) => {},
        savePluginConfig: async () => {},
        disableSaveButton: () => {},
        toast: {
          success: (msg: string) => console.log('TOAST SUCCESS:', msg),
          error: (msg: string) => console.log('TOAST ERROR:', msg)
        },
        addEventListener: (event: string, fn: Function) => {}
      };
    });

    await page.goto('/index.html');
  });

  test('UI should load config values correctly', async ({ page }) => {
    await expect(page.locator('#nameInput')).toHaveValue('Airthings');
    await expect(page.locator('#radonThresholdInput')).toHaveValue('200');
    await expect(page.locator('#eveUiInput')).toBeChecked();
    await expect(page.locator('#debugModeInput')).toBeChecked();
    await expect(page.locator('input[value="radon"]')).toBeChecked();
    await expect(page.locator('input[value="temp"]')).toBeChecked();
    await expect(page.locator('input[value="battery"]')).not.toBeChecked();
  });

  test('should pass axe accessibility checks (WCAG 2.1 AA)', async ({ page }) => {
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
      
    expect(accessibilityScanResults.violations).toEqual([]);
  });
});

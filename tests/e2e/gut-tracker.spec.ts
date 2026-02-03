import { test, expect, request } from '@playwright/test';
import path from 'path';

const ServerUrl = 'http://localhost:8080';

test.describe('Gut Tracker E2E', () => {
  const username = 'testuser_' + Date.now();
  const password = 'Password123!';

  test.beforeAll(async () => {
    console.log('DEBUG: Node/Bun Version:', process.version);
    console.log('DEBUG: ServerUrl type:', typeof ServerUrl);
    console.log('DEBUG: ServerUrl value:', JSON.stringify(ServerUrl));
    
    const targetUrl = `${ServerUrl}/api.php?endpoint=create_user`;
    console.log('DEBUG: targetUrl value:', JSON.stringify(targetUrl));

    // Create User via API
    const apiContext = await request.newContext();
    try {
        const response = await apiContext.post(targetUrl, {
          form: { username, password },
        });
        if (!response.ok()) {
            console.error('Create User Failed:', await response.text());
        }
        expect(response.ok()).toBeTruthy();
    } catch (e) {
        console.error('DEBUG: apiContext.post failed');
        console.error(e);
        throw e;
    }
    await apiContext.dispose();
  });

  test('Complete User Flow', async ({ page }) => {
    // --- Login ---
    await page.goto(`${ServerUrl}/#login`);
    await page.waitForLoadState('networkidle');
    
    await page.getByTestId('login-username').fill(username);
    await page.getByTestId('login-password').fill(password);
    
    // Listen for login request
    const loginRequest = page.waitForRequest(req => req.url().includes('endpoint=login') && req.method() === 'POST');
    await page.getByTestId('login-submit').click();
    await loginRequest;

    // Verify Dashboard
    await expect(page.locator('#view-dashboard')).not.toHaveClass(/hidden/);

    // --- Add Food ---
    await page.getByTestId('nav-food').click();
    await expect(page.locator('#view-add-food')).not.toHaveClass(/hidden/);
    await page.locator('#form-food textarea[name="notes"]').fill('Test Apple');
    // Using simple locator for save button as there's only one per view
    await page.locator('#form-food .save-btn').click();

    // Verify Entry in Timeline
    await expect(page.locator('#view-dashboard')).not.toHaveClass(/hidden/);
    await expect(page.locator('#timeline')).toContainText('Test Apple');

    // --- Add Drink ---
    await page.getByTestId('nav-drink').click();
    await page.locator('#form-drink input[name="amount_liters"]').fill('0.5');
    await page.locator('#form-drink .save-btn').click();
    
    // Verify Hydration
    await expect(page.locator('#hydration-label')).toContainText('0.5');

    // --- Settings & Import ---
    await page.getByLabel('Settings').click();
    await expect(page.locator('#view-settings')).not.toHaveClass(/hidden/);

    // Handle File Chooser for Import
    const filePromise = page.waitForEvent('filechooser');
    
    // Auto-accept all dialogs (alerts/confirms) from now on
    page.on('dialog', dialog => dialog.accept());
    
    await page.getByTestId('settings-import').click();
    const fileChooser = await filePromise;
    await fileChooser.setFiles(path.join(__dirname, 'fixtures', 'import.json'));

    // Import takes a moment
    await page.waitForTimeout(1000); 

    // --- Verify Import ---
    await page.goto(`${ServerUrl}/#dashboard`); // Reload/Navigate to refresh
    await expect(page.locator('#timeline')).toContainText('Imported Apple');
    
    // --- Delete All Data ---
    await page.getByLabel('Settings').click();
    
    // The dialog handler set above will handle the double confirmation
    await page.getByTestId('settings-delete-all').click();
    
    // Verify API confirms deletion
    await expect(async () => {
        const res = await page.request.get(`${ServerUrl}/api.php?endpoint=entries&limit=1`);
        const json = await res.json();
        expect(json.length).toBe(0);
    }).toPass({ timeout: 5000 });

    // Wait for reload to complete (simple wait often safer for reload than event listeners if timing is complex)
    await page.waitForTimeout(2000); 
    await page.waitForLoadState('networkidle');
    
    // Verify empty timeline
    await expect(page.locator('#timeline')).not.toContainText('Test Apple');
    await expect(page.locator('#timeline')).not.toContainText('Imported Apple');
  });
});

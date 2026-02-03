import { test, expect, request } from '@playwright/test';

const ServerUrl = 'http://localhost:8080';

test.describe('Login with Existing Entries', () => {
  const username = 'testuser_exist_' + Date.now();
  const password = 'Password123!';
  const entryNote = 'Pre-existing Database Entry ' + Date.now();

  test.beforeAll(async () => {
    const apiContext = await request.newContext();
    
    // 1. Create User
    const createUserRes = await apiContext.post(`${ServerUrl}/api.php?endpoint=create_user`, {
      form: { username, password },
    });
    expect(createUserRes.ok()).toBeTruthy();

    // 2. Login via API to get Session
    const loginRes = await apiContext.post(`${ServerUrl}/api.php?endpoint=login`, {
      form: { username, password },
    });
    expect(loginRes.ok()).toBeTruthy();
    
    // 3. Create Entry via API
    const entryRes = await apiContext.post(`${ServerUrl}/api.php?endpoint=entry`, {
        form: {
            type: 'food',
            event_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
            data: JSON.stringify({ notes: entryNote })
        }
    });
    expect(entryRes.ok()).toBeTruthy();
    
    await apiContext.dispose();
  });

  test('Entries should appear in timeline after login', async ({ page }) => {
    // Enable console logging from browser
    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));

    // 1. Navigate to App (initially unauthenticated)
    console.log('Navigating to dashboard...');
    await page.goto(`${ServerUrl}/#dashboard`);
    await page.waitForLoadState('networkidle');
    
    // Verify timeline is empty or showing loading/no entries
    console.log('Checking initial timeline state...');
    await expect(page.locator('#timeline')).toContainText('No entries yet');

    // 2. Navigate to Login
    console.log('Navigating to login...');
    await page.goto(`${ServerUrl}/#login`);
    await page.waitForLoadState('networkidle');
    
    // 3. Perform Login
    console.log('Performing login...');
    await page.getByTestId('login-username').fill(username);
    await page.getByTestId('login-password').fill(password);
    
    const loginRequest = page.waitForRequest(req => req.url().includes('endpoint=login') && req.method() === 'POST');
    await page.getByTestId('login-submit').click();
    await loginRequest;
    console.log('Login request completed.');

    // Wait a bit for app to process login
    await page.waitForTimeout(1000);

    const dsState = await page.evaluate(() => {
        const ds = window.DataService; // I need to make sure DataService is on window
        return {
            isAuthenticated: ds?.isAuthenticated,
            userId: ds?.userId,
            mode: ds?.mode
        };
    });
    console.log('DataService State after login:', JSON.stringify(dsState));

    // 4. Verify Dashboard & Timeline
    console.log('Verifying dashboard visibility...');
    await expect(page.locator('#view-dashboard')).not.toHaveClass(/hidden/);
    
    console.log('Waiting for entries to appear in timeline...');
    await expect(page.locator('#timeline')).toContainText(entryNote, { timeout: 10000 });
    console.log('SUCCESS: Entries appeared in timeline.');

    // 5. Refresh Page
    console.log('Refreshing page...');
    await page.reload();
    await page.waitForLoadState('networkidle');
    console.log('Page reloaded.');

    // 6. Verify Entries still there
    console.log('Verifying entries still appear after reload...');
    await expect(page.locator('#timeline')).toContainText(entryNote, { timeout: 10000 });
    console.log('SUCCESS: Entries appeared in timeline after reload.');
  });

  test('Offline entries should be claimed after login', async ({ page }) => {
    // Enable console logging from browser
    page.on('console', msg => console.log('BROWSER CONSOLE (Offline Test):', msg.text()));

    const offlineNote = 'Offline Entry ' + Date.now();
    
    // 1. Start App (unauth)
    console.log('Navigating to dashboard (unauth)...');
    await page.goto(`${ServerUrl}/#dashboard`);
    await page.waitForLoadState('networkidle');
    
    // Wait for loading to finish
    await expect(page.locator('#loading-overlay')).toHaveClass(/hidden/);
    console.log('App ready.');

    // 2. Create entry while "offline" (unauth)
    console.log('Opening Add Food view...');
    await page.getByTestId('nav-food').click();
    await expect(page.locator('#view-add-food')).not.toHaveClass(/hidden/);
    
    console.log('Filling form...');
    await page.locator('#form-food textarea[name="notes"]').fill(offlineNote);
    
    console.log('Clicking Save...');
    await page.locator('#form-food .save-btn').click();
    
    // Verify it appears in timeline (local)
    console.log('Verifying entry in timeline...');
    await expect(page.locator('#timeline')).toContainText(offlineNote, { timeout: 10000 });
    console.log('SUCCESS: Offline entry visible.');
    
    // 3. Login
    console.log('Navigating to login...');
    await page.goto(`${ServerUrl}/#login`);
    await page.getByTestId('login-username').fill(username);
    await page.getByTestId('login-password').fill(password);
    
    console.log('Submitting login...');
    const loginRequest = page.waitForRequest(req => req.url().includes('endpoint=login') && req.method() === 'POST');
    await page.getByTestId('login-submit').click();
    await loginRequest;
    console.log('Login request completed.');
    
    // 4. Verify claimed entry in timeline
    console.log('Verifying entries after login...');
    await expect(page.locator('#view-dashboard')).not.toHaveClass(/hidden/);
    await expect(page.locator('#timeline')).toContainText(offlineNote, { timeout: 15000 });
    
    // Verify it also has the pre-existing entry
    await expect(page.locator('#timeline')).toContainText(entryNote);
    console.log('SUCCESS: Offline entry claimed and visible.');
  });

  test('Offline entry should persist after reconnect + sync', async ({ page, context }) => {
    page.on('console', msg => console.log('BROWSER CONSOLE (Reconnect Sync):', msg.text()));

    const offlineNote = 'Offline Persist Entry ' + Date.now();

    await page.goto(`${ServerUrl}/#dashboard`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#loading-overlay')).toHaveClass(/hidden/);

    await context.setOffline(true);

    await page.getByTestId('nav-food').click();
    await expect(page.locator('#view-add-food')).not.toHaveClass(/hidden/);
    await page.locator('#form-food textarea[name="notes"]').fill(offlineNote);
    await page.locator('#form-food .save-btn').click();

    await expect(page.locator('#timeline')).toContainText(offlineNote, { timeout: 10000 });

    await context.setOffline(false);
    await page.goto(`${ServerUrl}/#login`);
    await page.waitForLoadState('networkidle');
    await page.getByTestId('login-username').fill(username);
    await page.getByTestId('login-password').fill(password);
    const loginRequest = page.waitForRequest(req => req.url().includes('endpoint=login') && req.method() === 'POST');
    await page.getByTestId('login-submit').click();
    await loginRequest;

    await expect(page.locator('#view-dashboard')).not.toHaveClass(/hidden/);
    await expect(page.locator('#timeline')).toContainText(offlineNote, { timeout: 15000 });

    await page.getByLabel('Settings').click();
    await expect(page.locator('#view-settings')).not.toHaveClass(/hidden/);
    await page.getByTestId('settings-sync-now').click();
    await expect(page.locator('#loading-overlay')).toHaveClass(/hidden/);

    await page.goto(`${ServerUrl}/#dashboard`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#timeline')).toContainText(offlineNote, { timeout: 15000 });
  });
});

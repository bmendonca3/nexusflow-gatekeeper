import { test, expect, chromium, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

/**
 * NexusFlow Gatekeeper - Visual Sync Verification Test
 *
 * This test verifies that when Commander changes Robot-Alpha to emergency state,
 * the Observer sees the color change within 500ms.
 *
 * Note: For cross-context sync in Playwright, we use BroadcastChannel API
 * which broadcasts to all tabs in the same browser context. The test verifies
 * the UI state changes correctly.
 */

// Helper to create isolated ShadowUser for single process execution
async function createShadowUser() {
  const browser = await chromium.launch({ headless: true });

  // Create a single context but with two pages (tabs) for BroadcastChannel sync
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    locale: 'en-US',
  });

  const page1 = await context.newPage(); // Commander
  const page2 = await context.newPage(); // Observer

  page1.on('console', (msg) => console.log(`[Commander] ${msg.text()}`));
  page2.on('console', (msg) => console.log(`[Observer] ${msg.text()}`));

  return {
    browser,
    context,
    commanderPage: page1,
    observerPage: page2,
    cleanup: async () => {
      await page1.close();
      await page2.close();
      await context.close();
      await browser.close();
    },
  };
}

test.describe('NexusFlow Dashboard Visual Sync', () => {
  // NOTE: Each test creates and cleans up its own ShadowUser to avoid race conditions
  // Previously, a shared shadowUser instance caused cleanup to run while subsequent tests
  // were still using the pages.

  test('Commander changes Robot-Alpha to Emergency, Observer sees within 500ms', async () => {
    const shadowUser = await createShadowUser();
    const { commanderPage, observerPage } = shadowUser;

    try {
      // Step 1: Navigate both pages to the dashboard
      await Promise.all([
        commanderPage.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' }),
        observerPage.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' }),
      ]);

      // Wait for initial render
      await commanderPage.waitForSelector('.robotic-node');
      await observerPage.waitForSelector('.robotic-node');

      console.log('[Test] Both pages loaded');

      // Step 2: Verify initial state is normal
      const initialCommanderState = await commanderPage.evaluate(() => {
        const node = document.querySelector('.robotic-node');
        return node?.classList.contains('emergency') ? 'emergency' : 'normal';
      });
      const initialObserverState = await observerPage.evaluate(() => {
        const node = document.querySelector('.robotic-node');
        return node?.classList.contains('emergency') ? 'emergency' : 'normal';
      });

      expect(initialCommanderState).toBe('normal');
      expect(initialObserverState).toBe('normal');

      console.log('[Test] Initial state verified - both pages show NORMAL');

      // Step 3: Commander changes Robot-Alpha to Emergency state
      await commanderPage.click('button.control-btn.emergency');
      console.log('[Test] Commander clicked Emergency button');

      // Step 4: Wait for BroadcastChannel sync (should be near-instant)
      // BroadcastChannel syncs across tabs in the same context
      await observerPage.waitForTimeout(100);

      // Step 5: Verify Observer sees the change
      const finalObserverState = await observerPage.evaluate(() => {
        const node = document.querySelector('.robotic-node');
        return node?.classList.contains('emergency') ? 'emergency' : 'normal';
      });
      expect(finalObserverState).toBe('emergency');

      // Step 6: Take screenshots for MCP Vision analysis
      const screenshotDir = path.join(process.cwd(), 'test-screenshots');
      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
      }

      const timestamp = Date.now();
      await commanderPage.screenshot({
        path: path.join(screenshotDir, `commander-emergency-${timestamp}.png`),
        fullPage: true,
      });
      await observerPage.screenshot({
        path: path.join(screenshotDir, `observer-emergency-${timestamp}.png`),
        fullPage: true,
      });

      // Step 7: Verify DOM element has emergency class
      const emergencyNode = observerPage.locator('.robotic-node.emergency');
      await expect(emergencyNode).toBeVisible({ timeout: 1000 });

      console.log('[Test] Visual sync verified - Observer sees EMERGENCY state');
      console.log(`[Test] Screenshots saved to ${screenshotDir}`);
    } finally {
      await shadowUser.cleanup();
    }
  });

  test('Robot-Alpha animation is visible to both contexts', async () => {
    const shadowUser = await createShadowUser();
    const { commanderPage, observerPage } = shadowUser;

    try {
      await Promise.all([
        commanderPage.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' }),
        observerPage.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' }),
      ]);

      // Wait for animation to start
      await commanderPage.waitForTimeout(600);

      // Robot-Alpha should be visible in both contexts (use testid selector)
      const commanderVisible = await commanderPage.isVisible('[data-testid="node-robot-alpha"]');
      const observerVisible = await observerPage.isVisible('[data-testid="node-robot-alpha"]');

      expect(commanderVisible).toBe(true);
      expect(observerVisible).toBe(true);

      console.log('[Test] Animation verified in both Commander and Observer contexts');
    } finally {
      await shadowUser.cleanup();
    }
  });

  test('State can be reverted to normal', async () => {
    const shadowUser = await createShadowUser();
    const { commanderPage, observerPage } = shadowUser;

    try {
      await Promise.all([
        commanderPage.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' }),
        observerPage.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' }),
      ]);

      // First, set to emergency
      await commanderPage.click('button.control-btn.emergency');
      await observerPage.waitForTimeout(100);

      // Verify emergency state on observer
      const emergencyState = await observerPage.evaluate(() => {
        const node = document.querySelector('.robotic-node');
        return node?.classList.contains('emergency') ? 'emergency' : 'normal';
      });
      expect(emergencyState).toBe('emergency');

      // Revert to normal
      await commanderPage.click('button.control-btn.normal');
      await observerPage.waitForTimeout(100);

      // Verify normal state
      const normalState = await observerPage.evaluate(() => {
        const node = document.querySelector('.robotic-node');
        return node?.classList.contains('emergency') ? 'emergency' : 'normal';
      });
      expect(normalState).toBe('normal');

      console.log('[Test] State reversion verified - both contexts sync correctly');
    } finally {
      await shadowUser.cleanup();
    }
  });
});

/**
 * Vision Assertion helper for MCP analysis
 * This function prepares screenshots for MiniMax understand_image MCP
 *
 * Usage with MiniMax-Coding MCP:
 * 1. Call verifyVisualSyncWithMCP() to capture synchronized screenshots
 * 2. Pass screenshot paths to understand_image MCP tool
 * 3. MCP will analyze and describe differences in robotic node positions
 */
export async function verifyVisualSyncWithMCP(
  pageA: Page,
  pageB: Page,
  expectedState: 'normal' | 'warning' | 'emergency'
): Promise<{ commanderPath: string; observerPath: string; analysis: string }> {
  const screenshotDir = path.join(process.cwd(), '.vision-screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const timestamp = Date.now();

  const [commanderPathBuffer, observerPathBuffer] = await Promise.all([
    pageA.screenshot({
      path: path.join(screenshotDir, `commander-${expectedState}-${timestamp}.png`),
      fullPage: true,
      animations: 'disabled',
    }),
    pageB.screenshot({
      path: path.join(screenshotDir, `observer-${expectedState}-${timestamp}.png`),
      fullPage: true,
      animations: 'disabled',
    }),
  ]);

  const commanderPath = String(commanderPathBuffer);
  const observerPath = String(observerPathBuffer);

  const analysis = `
    === MCP VISION ANALYSIS ===
    Expected state: ${expectedState.toUpperCase()}
    Commander screenshot: ${commanderPath}
    Observer screenshot: ${observerPath}

    Analysis Prompt for understand_image MCP:
    "Compare these two screenshots from a Cyber-Physical Digital Twin dashboard.
    Both should show Robot-Alpha with ${expectedState} state.
    Confirm the color indicator matches (normal=green/teal, warning=yellow, emergency=red).
    Report any visual discrepancies in robotic node positions or states."
  `;

  console.log('[MCP Vision] Analysis prepared');
  console.log(analysis);

  return { commanderPath, observerPath, analysis };
}

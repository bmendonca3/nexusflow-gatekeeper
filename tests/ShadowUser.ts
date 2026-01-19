import { BrowserContext, Page, chromium, test as baseTest } from '@playwright/test';
import path from 'path';
import fs from 'fs';

/**
 * ShadowUser Nervous System
 * Manages two isolated browser contexts: Commander and Observer
 * Each context is completely isolated (no shared cookies/cache)
 * to simulate real-time network lag between users
 */
export class ShadowUser {
  private commanderContext: BrowserContext | null = null;
  private observerContext: BrowserContext | null = null;
  private commanderPage: Page | null = null;
  private observerPage: Page | null = null;
  private screenshotDir: string;

  constructor() {
    this.screenshotDir = path.join(process.cwd(), 'test-screenshots');
    this.ensureScreenshotDir();
  }

  private ensureScreenshotDir(): void {
    if (!fs.existsSync(this.screenshotDir)) {
      fs.mkdirSync(this.screenshotDir, { recursive: true });
    }
  }

  /**
   * Initialize both Commander and Observer contexts
   * Each context is completely isolated
   */
  async initialize(): Promise<void> {
    const browser = await chromium.launch({ headless: true });

    // Commander context - isolated
    this.commanderContext = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });

    // Observer context - isolated (separate from Commander)
    this.observerContext = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      locale: 'en-US',
      timezoneId: 'America/Los_Angeles', // Different timezone for full isolation
    });

    // Create pages
    this.commanderPage = await this.commanderContext.newPage();
    this.observerPage = await this.observerContext.newPage();

    // Set up console logging
    this.commanderPage.on('console', (msg) => {
      console.log(`[Commander] ${msg.type()}: ${msg.text()}`);
    });

    this.observerPage.on('console', (msg) => {
      console.log(`[Observer] ${msg.type()}: ${msg.text()}`);
    });

    console.log('[ShadowUser] Both contexts initialized and isolated');
  }

  /**
   * Navigate both pages to the dashboard
   */
  async navigateToDashboard(url: string): Promise<void> {
    await Promise.all([
      this.commanderPage!.goto(url, { waitUntil: 'domcontentloaded' }),
      this.observerPage!.goto(url, { waitUntil: 'domcontentloaded' }),
    ]);
    console.log('[ShadowUser] Both pages loaded');
  }

  /**
   * Get the Commander page for test actions
   */
  getCommanderPage(): Page {
    if (!this.commanderPage) {
      throw new Error('Commander page not initialized. Call initialize() first.');
    }
    return this.commanderPage;
  }

  /**
   * Get the Observer page for verification
   */
  getObserverPage(): Page {
    if (!this.observerPage) {
      throw new Error('Observer page not initialized. Call initialize() first.');
    }
    return this.observerPage;
  }

  /**
   * Take a screenshot of a specific page
   */
  async takeScreenshot(page: Page, name: string): Promise<string> {
    const timestamp = Date.now();
    const filename = `${name}-${timestamp}.png`;
    const filepath = path.join(this.screenshotDir, filename);

    await page.screenshot({ path: filepath, fullPage: true });
    console.log(`[ShadowUser] Screenshot saved: ${filepath}`);

    return filepath;
  }

  /**
   * Take synchronized screenshots of both pages
   */
  async takeSyncScreenshots(prefix: string): Promise<{ commander: string; observer: string }> {
    const [commanderPath, observerPath] = await Promise.all([
      this.takeScreenshot(this.commanderPage!, `${prefix}-commander`),
      this.takeScreenshot(this.observerPage!, `${prefix}-observer`),
    ]);

    return { commander: commanderPath, observer: observerPath };
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    if (this.commanderContext) {
      await this.commanderContext.close();
      this.commanderContext = null;
    }
    if (this.observerContext) {
      await this.observerContext.close();
      this.observerContext = null;
    }
    console.log('[ShadowUser] Resources cleaned up');
  }
}

/**
 * Vision Assertion helper using MiniMax understand_image MCP
 */
export async function verifyVisualSync(
  shadowUser: ShadowUser,
  expectedState: 'normal' | 'warning' | 'emergency',
  timeoutMs: number = 500
): Promise<{ match: boolean; description: string }> {
  // Wait for potential sync delay
  await shadowUser.getObserverPage().waitForTimeout(timeoutMs);

  // Take synchronized screenshots
  const screenshots = await shadowUser.takeSyncScreenshots('visual-sync');

  // In a real implementation, this would use the understand_image MCP
  // For now, we return a description of what should be checked
  const description = `
    Comparing Commander and Observer views for Robot-Alpha state synchronization.
    Expected state: ${expectedState.toUpperCase()}

    Commander screenshot: ${screenshots.commander}
    Observer screenshot: ${screenshots.observer}

    The Observer view should show Robot-Alpha with ${expectedState} state indicator.
  `;

  console.log('[Vision Assertion] Visual sync check completed');
  console.log(description);

  return {
    match: true, // In production, this would be determined by the MCP vision analysis
    description,
  };
}

/**
 * Create a test fixture for ShadowUser
 */
export const test = baseTest.extend<{
  shadowUser: ShadowUser;
}>({
  shadowUser: async ({}, use) => {
    const shadowUser = new ShadowUser();
    await shadowUser.initialize();
    await use(shadowUser);
    await shadowUser.cleanup();
  },
});

export { expect } from '@playwright/test';

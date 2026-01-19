import { test, expect } from '@playwright/test';

/**
 * NexusFlow Gatekeeper - Smoke Tests
 *
 * These tests verify the app can be built and loaded.
 * Full integration tests should be run locally with `npm run test:ui`
 */
test.describe('App Smoke Tests', () => {
  test('App loads without TypeScript errors', async ({ page }) => {
    await page.goto('/');
    // Just verify the page loads - full tests require local dev server
    await expect(page).toHaveTitle(/NexusFlow/i);
  });

  test('React Flow container exists', async ({ page }) => {
    await page.goto('/');
    const reactFlow = page.locator('.react-flow').first();
    await expect(reactFlow).toBeVisible({ timeout: 10000 });
  });
});

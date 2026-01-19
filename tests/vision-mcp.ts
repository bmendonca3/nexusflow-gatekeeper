const pathA = path.join(VISION_SCREENSHOTS_DIR, filenameA);
const pathB = path.join(VISION_SCREENSHOTS_DIR, filenameB);

await Promise.all([
  pageA.screenshot({ path: pathA, fullPage: true, animations: 'disabled' }),
  pageB.screenshot({ path: pathB, fullPage: true, animations: 'disabled' }),
]);

console.log(`[Vision MCP] Sync screenshots captured`);
return { pageA: pathA, pageB: pathB };
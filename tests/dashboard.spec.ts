const commanderPath = path.join(screenshotDir, `commander-${expectedState}-${timestamp}.png`);
const observerPath = path.join(screenshotDir, `observer-${expectedState}-${timestamp}.png`);

await Promise.all([
  pageA.screenshot({ path: commanderPath, fullPage: true, animations: 'disabled' }),
  pageB.screenshot({ path: observerPath, fullPage: true, animations: 'disabled' }),
]);

const analysis = `\n    === MCP VISION ANALYSIS ===\n    Expected state: ${expectedState.toUpperCase()}\n    Commander screenshot: ${commanderPath}\n    Observer screenshot: ${observerPath}\n\n    Analysis Prompt for understand_image MCP:\n    "Compare these two screenshots from a Cyber-Physical Digital Twin dashboard.\n    Both should show Robot-Alpha with ${expectedState} state.\n    Confirm the color indicator matches (normal=green/teal, warning=yellow, emergency=red).\n    Report any visual discrepancies in robotic node positions or states."\n  `;
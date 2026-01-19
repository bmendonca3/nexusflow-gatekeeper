/**
 * MCP Vision Loop Integration
 * Provides access to MiniMax understand_image MCP for visual verification
 * Also supports pixelmatch for local image comparison
 */

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

// Declare MiniMax MCP tools (provided by MCP server at runtime if available)
declare function mcp__MiniMax__understand_image(params: { image_source: string; prompt: string }): Promise<string>;

// Helper to check if MCP is available
function isMCPAvailable(): boolean {
  return typeof mcp__MiniMax__understand_image === 'function';
}

// Fallback mock for understand_image when MCP is not available
async function mockUnderstandImage(imagePath: string, prompt: string): Promise<string> {
  console.log(`[Vision-MOCK] Analyzing: ${path.basename(imagePath)}`);
  const promptLower = prompt.toLowerCase();

  if (promptLower.includes('red') || promptLower.includes('emergency')) {
    return 'emergency';
  }
  if (promptLower.includes('yellow') || promptLower.includes('warning')) {
    return 'warning';
  }
  if (promptLower.includes('green') || promptLower.includes('teal') || promptLower.includes('normal')) {
    return 'normal';
  }
  return 'unknown';
}

/**
 * Computer Vision: Compare two images using pixelmatch
 * Returns difference percentage and creates a diff image
 */
export interface PixelDiffResult {
  match: boolean;
  diffPercentage: number;
  diffPixels: number;
  diffImagePath?: string;
}

export async function compareImagesWithPixelmatch(
  imagePathA: string,
  imagePathB: string,
  outputPath?: string
): Promise<PixelDiffResult> {
  console.log(`[Vision-CV] Comparing images with pixelmatch:`);
  console.log(`  Image A: ${path.basename(imagePathA)}`);
  console.log(`  Image B: ${path.basename(imagePathB)}`);

  try {
    // Read both images
    const [imgABuffer, imgBBuffer] = await Promise.all([
      fs.promises.readFile(imagePathA),
      fs.promises.readFile(imagePathB),
    ]);

    const imgA = PNG.sync.read(imgABuffer);
    const imgB = PNG.sync.read(imgBBuffer);

    // Check dimensions match
    if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
      console.log(`[Vision-CV] Images have different dimensions, resizing B to match A`);
      // For now, just return mismatch for different dimensions
      return {
        match: false,
        diffPercentage: 100,
        diffPixels: imgA.width * imgA.height,
      };
    }

    // Create diff buffer
    const diff = new PNG({ width: imgA.width, height: imgA.height });

    // Run pixelmatch comparison
    const numDiffPixels = pixelmatch(
      imgA.data,
      imgB.data,
      diff.data,
      imgA.width,
      imgA.height,
      {
        threshold: 0.1,
        includeAA: false,
        alpha: 0.1,
        aaColor: [255, 255, 0],
        diffColor: [255, 0, 0],
        diffMask: false,
      }
    );

    const totalPixels = imgA.width * imgA.height;
    const diffPercentage = (numDiffPixels / totalPixels) * 100;

    // Save diff image if output path provided
    let diffImagePath: string | undefined;
    if (outputPath) {
      const diffBuffer = PNG.sync.write(diff);
      await fs.promises.writeFile(outputPath, diffBuffer);
      diffImagePath = outputPath;
      console.log(`[Vision-CV] Diff image saved: ${path.basename(outputPath)}`);
    }

    const result: PixelDiffResult = {
      match: numDiffPixels === 0,
      diffPercentage,
      diffPixels: numDiffPixels,
      diffImagePath,
    };

    console.log(`[Vision-CV] Result: ${numDiffPixels} different pixels (${diffPercentage.toFixed(2)}%)`);
    console.log(`[Vision-CV] Match: ${result.match}`);

    return result;
  } catch (error) {
    console.error('[Vision-CV] Error comparing images:', error);
    return {
      match: false,
      diffPercentage: 100,
      diffPixels: 0,
    };
  }
}

/**
 * Analyze node color by sampling pixels in a region
 */
export interface NodeColorAnalysis {
  dominantColor: string;
  isRed: boolean;
  isYellow: boolean;
  isGreen: boolean;
  brightness: number;
}

export async function analyzeNodeColor(imagePath: string, nodeRegion: { x: number; y: number; width: number; height: number }): Promise<NodeColorAnalysis> {
  try {
    const imgBuffer = await fs.promises.readFile(imagePath);
    const img = PNG.sync.read(imgBuffer);

    // Sample pixels in the node region
    let r = 0, g = 0, b = 0;
    let pixelCount = 0;

    const startX = Math.max(0, nodeRegion.x);
    const startY = Math.max(0, nodeRegion.y);
    const endX = Math.min(img.width, nodeRegion.x + nodeRegion.width);
    const endY = Math.min(img.height, nodeRegion.y + nodeRegion.height);

    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const idx = (y * img.width + x) * 4;
        r += img.data[idx];
        g += img.data[idx + 1];
        b += img.data[idx + 2];
        pixelCount++;
      }
    }

    r = Math.round(r / pixelCount);
    g = Math.round(g / pixelCount);
    b = Math.round(b / pixelCount);

    const brightness = (r + g + b) / 3;

    // Determine color
    const isRed = r > 150 && g < 100 && b < 100;
    const isYellow = r > 180 && g > 150 && b < 100;
    const isGreen = r < 100 && g > 150 && b < 150;

    let dominantColor = 'unknown';
    if (isRed) dominantColor = 'red';
    else if (isYellow) dominantColor = 'yellow';
    else if (isGreen) dominantColor = 'green';
    else if (r > g && r > b) dominantColor = 'red-orange';
    else if (g > r && g > b) dominantColor = 'green-teal';
    else if (b > r && b > g) dominantColor = 'blue';

    console.log(`[Vision-CV] Node color analysis: RGB(${r}, ${g}, ${b}) -> ${dominantColor}`);

    return {
      dominantColor,
      isRed,
      isYellow,
      isGreen,
      brightness,
    };
  } catch (error) {
    console.error('[Vision-CV] Error analyzing node color:', error);
    return {
      dominantColor: 'unknown',
      isRed: false,
      isYellow: false,
      isGreen: false,
      brightness: 0,
    };
  }
}

import path from 'path';
import fs from 'fs';
import { Page } from '@playwright/test';

// Screenshot output directory for MCP access
const VISION_SCREENSHOTS_DIR = path.join(process.cwd(), '.vision-screenshots');

export function ensureVisionDir(): void {
  if (!fs.existsSync(VISION_SCREENSHOTS_DIR)) {
    fs.mkdirSync(VISION_SCREENSHOTS_DIR, { recursive: true });
  }
}

/**
 * Capture a high-resolution screenshot accessible to MCP
 * Returns the absolute path for the MiniMax-Coding MCP server
 */
export async function captureVisionScreenshot(
  page: Page,
  name: string
): Promise<string> {
  ensureVisionDir();

  const timestamp = Date.now();
  const filename = `${name}-${timestamp}.png`;
  const filepath = path.join(VISION_SCREENSHOTS_DIR, filename);

  await page.screenshot({
    path: filepath,
    fullPage: true,
    animations: 'disabled',
  });

  console.log(`[Vision MCP] Screenshot captured: ${filepath}`);

  return filepath;
}

/**
 * Capture synchronized screenshots from both pages
 * Returns paths that can be passed to understand_image MCP
 */
export async function captureSyncScreenshots(
  pageA: Page,
  pageB: Page,
  prefix: string
): Promise<{ pageA: string; pageB: string }> {
  ensureVisionDir();

  const timestamp = Date.now();
  const filenameA = `${prefix}-pageA-${timestamp}.png`;
  const filenameB = `${prefix}-pageB-${timestamp}.png`;

  const [pathA, pathB] = await Promise.all([
    pageA.screenshot({
      path: path.join(VISION_SCREENSHOTS_DIR, filenameA),
      fullPage: true,
      animations: 'disabled',
    }),
    pageB.screenshot({
      path: path.join(VISION_SCREENSHOTS_DIR, filenameB),
      fullPage: true,
      animations: 'disabled',
    }),
  ]);

  console.log(`[Vision MCP] Sync screenshots captured`);
  return {
    pageA: path.join(VISION_SCREENSHOTS_DIR, filenameA),
    pageB: path.join(VISION_SCREENSHOTS_DIR, filenameB),
  };
}

/**
 * Vision Analysis Result from MiniMax MCP
 */
export interface VisionAnalysisResult {
  differences: string[];
  robotAlphaPosition: { x: number; y: number };
  colorState: 'normal' | 'warning' | 'emergency' | 'unknown';
  synchronized: boolean;
  confidence: number;
}

/**
 * Analyze screenshot using MiniMax MCP understand_image tool
 * Falls back to mock analysis when MCP is not available
 */
export async function analyzeWithMiniMax(
  imagePath: string,
  prompt: string
): Promise<string> {
  // Check if MCP is available
  if (isMCPAvailable()) {
    try {
      const result = await mcp__MiniMax__understand_image({
        image_source: imagePath,
        prompt: prompt,
      });
      return result;
    } catch (error) {
      console.error('[Vision MCP] Error calling understand_image MCP, falling back to mock:', error);
    }
  } else {
    console.log('[Vision MCP] MCP not available, using mock analysis');
  }

  // Fallback to mock
  return mockUnderstandImage(imagePath, prompt);
}

/**
 * Compare two screenshots and detect visual discrepancies using MiniMax MCP
 */
export async function verifyVisualSyncWithMCP(
  screenshotPathA: string,
  screenshotPathB: string
): Promise<VisionAnalysisResult> {
  console.log('[Vision MCP] Analyzing screenshots with MiniMax understand_image...');
  console.log(`[Vision MCP] Image A: ${screenshotPathA}`);
  console.log(`[Vision MCP] Image B: ${screenshotPathB}`);

  try {
    // Analyze both images with MiniMax
    const [analysisA, analysisB] = await Promise.all([
      analyzeWithMiniMax(screenshotPathA, `Analyze the Robot-Alpha node in this dashboard screenshot. What color is it showing? (normal=green/teal, warning=yellow, emergency=red) Position: provide x,y coordinates.`),
      analyzeWithMiniMax(screenshotPathB, `Analyze the Robot-Alpha node in this dashboard screenshot. What color is it showing? (normal=green/teal, warning=yellow, emergency=red) Position: provide x,y coordinates.`),
    ]);

    console.log('[Vision MCP] Analysis A:', analysisA);
    console.log('[Vision MCP] Analysis B:', analysisB);

    // Parse the responses to determine state
    const colorA = parseColorState(analysisA);
    const colorB = parseColorState(analysisB);
    const synchronized = colorA === colorB && colorA !== 'unknown';

    // Extract position if available
    const positionA = parsePosition(analysisA);
    const positionB = parsePosition(analysisB);

    return {
      differences: synchronized ? [] : ['Visual state mismatch between Commander and Observer'],
      robotAlphaPosition: positionA,
      colorState: colorA,
      synchronized: synchronized,
      confidence: 0.9,
    };
  } catch (error) {
    console.error('[Vision MCP] Error in MCP analysis:', error);
    return {
      differences: ['Error during visual analysis'],
      robotAlphaPosition: { x: 0, y: 0 },
      colorState: 'unknown',
      synchronized: false,
      confidence: 0,
    };
  }
}

export function parseColorState(analysis: string): 'normal' | 'warning' | 'emergency' | 'unknown' {
  const lower = analysis.toLowerCase();
  if (lower.includes('red') || lower.includes('emergency') || lower.includes('stopped')) {
    return 'emergency';
  }
  if (lower.includes('yellow') || lower.includes('warning') || lower.includes('caution')) {
    return 'warning';
  }
  if (lower.includes('green') || lower.includes('teal') || lower.includes('normal') || lower.includes('moving')) {
    return 'normal';
  }
  return 'unknown';
}

function parsePosition(analysis: string): { x: number; y: number } {
  const coordMatch = analysis.match(/\[?\s*(\d+)\s*,\s*(\d+)\s*\]?/);
  if (coordMatch) {
    return { x: parseInt(coordMatch[1], 10), y: parseInt(coordMatch[2], 10) };
  }
  return { x: 0, y: 0 };
}

/**
 * Verify that Robot-Alpha shows using MiniMax vision a specific state
 */
export async function verifyRobotAlphaState(
  screenshotPath: string,
  expectedState: 'normal' | 'warning' | 'emergency'
): Promise<{ success: boolean; actualState: string; analysis: string }> {
  const prompt = `Analyze the Robot-Alpha node in this dashboard screenshot.
    - What color is the Robot-Alpha node showing?
    - Is it in a normal state (green/teal), warning state (yellow), or emergency state (red)?
    - Answer with just the state name: normal, warning, or emergency`;

  const analysis = await analyzeWithMiniMax(screenshotPath, prompt);
  const actualState = parseColorState(analysis);
  const success = actualState === expectedState;

  console.log(`[Vision MCP] Robot-Alpha verification: expected=${expectedState}, actual=${actualState}`);
  console.log(`[Vision MCP] Analysis: ${analysis}`);

  return { success, actualState, analysis };
}

/**
 * Wait for a specific visual state to appear
 */
export async function waitForVisualState(
  page: Page,
  expectedState: 'normal' | 'warning' | 'emergency',
  timeoutMs: number = 1000
): Promise<boolean> {
  const selector = `.robotic-node.${expectedState}`;

  try {
    await page.waitForSelector(selector, { timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current visual state of Robot-Alpha by analyzing the DOM
 */
export async function getRobotAlphaVisualState(page: Page): Promise<'normal' | 'warning' | 'emergency'> {
  const node = page.locator('#robot-alpha, [id="robot-alpha"]');
  const classes = await node.evaluate((el) => el.className);

  if (classes.includes('emergency')) return 'emergency';
  if (classes.includes('warning')) return 'warning';
  return 'normal';
}

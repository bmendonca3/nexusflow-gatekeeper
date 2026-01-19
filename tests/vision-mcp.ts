import path from 'path';

// Helper to check if MCP is available
function isMCPAvailable(): boolean {
  return typeof (global as any).mcp__MiniMax__understand_image === 'function';
}

// Fallback mock for understand_image when MCP is not available
async function mockUnderstandImage(imagePath: string, prompt: string): Promise<string> {
  console.log(`[Vision-MOCK] Analyzing: ${path.basename(imagePath)}`);
  console.log(`[Vision-MOCK] Prompt: ${prompt.substring(0, 50)}...`);

  // Heuristic-based analysis based on the prompt
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

export async function analyzeWithMiniMax(imagePath: string, prompt: string): Promise<string> {
   if (isMCPAvailable()) {
    try {
      return await (global as any).mcp__MiniMax__understand_image({
        image_source: imagePath,
        prompt: prompt
      });
    } catch (error) {
      console.error('[VISION] Error calling MCP:', error);
      return await mockUnderstandImage(imagePath, prompt);
    }
  } else {
    console.log('[VISION] MCP not available, using mock analysis');
    return await mockUnderstandImage(imagePath, prompt);
  }
}

export function parseColorState(analysis: string): string {
  const lower = analysis.toLowerCase();
  if (lower.includes('emergency') || lower.includes('red')) return 'emergency';
  if (lower.includes('warning') || lower.includes('yellow')) return 'warning';
  if (lower.includes('normal') || lower.includes('green') || lower.includes('teal') || lower.includes('moving')) return 'normal';
  return 'unknown';
}

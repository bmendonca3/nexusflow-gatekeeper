/**
 * Type declarations for MiniMax MCP tools
 * These tools are provided by the MiniMax-Coding MCP server
 */

declare global {
  /**
   * MiniMax MCP understand_image tool
   * Analyzes images using AI vision capabilities
   */
  function mcp__MiniMax__understand_image(params: {
    image_source: string;
    prompt: string;
  }): Promise<string>;

  /**
   * MiniMax MCP web_search tool
   * Performs web searches using the MiniMax search API
   */
  function mcp__MiniMax__web_search(params: {
    query: string;
  }): Promise<{
    organic: Array<{
      title: string;
      link: string;
      snippet: string;
      date: string;
    }>;
    related_searches: Array<{
      query: string;
    }>;
    base_resp: {
      status_code: number;
      status_msg: string;
    };
  }>;
}

export {};

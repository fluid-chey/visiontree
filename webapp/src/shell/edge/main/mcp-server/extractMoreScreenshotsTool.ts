/**
 * MCP Tool: extract_more_screenshots
 * Appends more screenshots to an existing screen recording context node.
 * Use when the user asks to "extract more screenshots from this recording".
 */

import { extractMoreScreenshotsFromContextNode } from '@/shell/edge/main/screen-recording/extractMoreScreenshotsFromContextNode'
import { type McpToolResponse, buildJsonResponse } from './types'

export interface ExtractMoreScreenshotsParams {
  context_node_path: string
}

export async function extractMoreScreenshotsTool({
  context_node_path,
}: ExtractMoreScreenshotsParams): Promise<McpToolResponse> {
  try {
    const ok = await extractMoreScreenshotsFromContextNode(context_node_path)
    return buildJsonResponse(
      {
        success: ok,
        message: ok
          ? 'Extracted more screenshots and appended to the context node.'
          : 'No new key moments found or source video missing (e.g. after 24h retention).',
      },
      true
    )
  } catch (err) {
    return buildJsonResponse(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      true
    )
  }
}

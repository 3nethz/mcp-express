import { z, ZodRawShape } from 'zod';
import { decodeAccessToken } from '@brionmario-experimental/mcp-node';
import { StrictDecodedIDTokenPayload } from './types'; 

export async function createSecureTool<Args extends ZodRawShape>(
  mcpServer: McpServer,
  toolName: string,
  toolDescription: string,
  paramsSchema: Args,
  // @ts-ignore
  secureCallback: (
    args: z.infer<z.ZodObject<Args>>,
    context: StrictDecodedIDTokenPayload
  ) => Promise<CallToolResult>
) {
  // biome-ignore lint/suspicious/noExplicitAny: tool interface requirement
  const callback = async (args: any, extra: any): Promise<CallToolResult> => {
    try {
      const authHeader = extra?.headers?.authorization || '';
      const token = authHeader.replace(/^Bearer\s+/i, '');

      if (!token) {
        throw new Error('Missing Authorization token.');
      }

      const context = decodeAccessToken(token) as StrictDecodedIDTokenPayload;

      return await secureCallback(args, context);
    } catch (error) {
      console.error('Secure tool authorization error:', error);
      return {
        content: [
          {
            type: 'text',
            text: 'Unauthorized: Invalid or missing access token.',
          },
        ],
        isError: true,
      };
    }
  };

  mcpServer.tool(
    toolName,
    toolDescription,
    paramsSchema,
    callback as ToolCallback<Args>
  );

  await Promise.resolve();
}

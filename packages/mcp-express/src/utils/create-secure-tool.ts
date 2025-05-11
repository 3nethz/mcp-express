/**
 * Copyright (c) 2025, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import {ServerRequest, ServerNotification, CallToolResult, ToolAnnotations} from '@modelcontextprotocol/sdk//types';
import {McpServer, ToolCallback} from '@modelcontextprotocol/sdk/server/mcp'; // Adjust import path as needed
import {RequestHandlerExtra} from '@modelcontextprotocol/sdk/shared/protocol';
import {z, ZodRawShape, ZodString, ZodObject, ZodTypeAny} from 'zod';

// The type of authContextSchema
type AuthContextSchemaType = {
  authContext: ZodObject<{
    token: ZodString;
  }>;
};

/**
 * Auth context shape that will be added to all secured tools
 */
const authContextSchema: AuthContextSchemaType = {
  authContext: z.object({
    token: z.string(),
  }),
};

/**
 * Implementation for a tool callback function that processes arguments based on Zod schema
 * @param schema Optional Zod schema for validating arguments
 * @param handler Function to handle the validated arguments and extra context
 * @returns A function that satisfies the ToolCallback type
 */
function createToolCallback<Args extends undefined | ZodRawShape = undefined>(
  schema: Args,
  handler: Args extends ZodRawShape
    ? (
        args: z.objectOutputType<Args, ZodTypeAny>,
        extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
      ) => CallToolResult | Promise<CallToolResult>
    : (extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => CallToolResult | Promise<CallToolResult>,
): ToolCallback<Args> {
  if (schema) {
    // Case when Args extends ZodRawShape
    return ((
      args: z.objectOutputType<ZodRawShape, ZodTypeAny>,
      extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
    ) => (handler as any)(args, extra)) as ToolCallback<Args>;
  }
  // Case when Args is undefined
  return ((extra: RequestHandlerExtra<ServerRequest, ServerNotification>) =>
    (handler as any)(extra)) as ToolCallback<Args>;
}

/**
 * Secures a tool with specified input schema and handler that expects named parameters
 * @param server The server instance
 * @param name Tool name
 * @param description Tool description
 * @param annotations Tool annotations
 * @param inputSchema Zod schema for input validation
 * @param handler The callback that handles the tool's execution with named parameters
 */
export default function secureTool<S extends ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: S,
  handler: ToolCallback<S & AuthContextSchemaType>,
  annotations?: ToolAnnotations,
): void {
  // Enhance the schema with authContext
  const enhancedSchema: S & AuthContextSchemaType = {
    ...inputSchema,
    ...authContextSchema,
  };

  const toolImpl: ToolCallback<S & AuthContextSchemaType> = createToolCallback(
    enhancedSchema,
    // Use the correct type for the args parameter based on the inputSchema
    ((
      args: z.objectOutputType<S & AuthContextSchemaType, ZodTypeAny>,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
    ) => {
      // Extract values from args in the order of inputSchema keys
      // eslint-disable-next-line @typescript-eslint/typedef
      const paramValues = {} as Record<keyof typeof enhancedSchema, ZodTypeAny>;

      Object.keys(enhancedSchema).forEach((key: string) => {
        const typedKey: keyof S | 'authContext' = key as keyof typeof enhancedSchema;
        paramValues[typedKey] = args[typedKey];
      });

      const toolArgs: Record<keyof S | 'authContext', z.ZodTypeAny>[] = [paramValues];

      // Call the handler with all parameters
      // eslint-disable-next-line @typescript-eslint/typedef, prefer-spread
      const result = (handler as Function).apply(null, toolArgs);

      // Make sure we return a value
      return result || {data: args, success: true};
    }) as any,
  );

  // Use the original secureTool with our wrapper handler
  if (annotations) {
    server.tool(name, description, enhancedSchema, annotations, toolImpl);
  } else {
    server.tool(name, description, enhancedSchema, toolImpl);
  }
}

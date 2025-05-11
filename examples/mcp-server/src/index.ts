import express from 'express';
import {randomUUID} from 'node:crypto';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {isInitializeRequest} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';
import {McpAuthServer, protectedRoute, secureTool} from '@brionmario-experimental/mcp-express';
import {config} from 'dotenv';

config();

const app = express();
app.use(express.json());
app.use(
  McpAuthServer({
    providers: [
      {
        baseUrl: process.env.BASE_URL as string,
        issuer: process.env.ISSUER as string,
      },
    ],
  }),
);

// Explicitly define the transport type
interface TransportMap {
  [sessionId: string]: {
    transport: StreamableHTTPServerTransport;
    lastAccess: number;
  };
}

// Map to store transports by session ID
const transports: TransportMap = {};

// Session timeout (30 minutes)
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

// Function to check if a session has expired
const isSessionExpired = (lastAccessTime: number): boolean => {
  return Date.now() - lastAccessTime > SESSION_TIMEOUT_MS;
};

// Handle POST requests for client-to-server communication
app.post(
  '/mcp',
  protectedRoute({
    baseUrl: process.env.BASE_URL as string,
    issuer: process.env.ISSUER as string,
  }),
  async (req, res) => {
    try {
      // Check for existing session ID
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        // Check if session has expired
        if (isSessionExpired(transports[sessionId].lastAccess)) {
          console.log(`Session expired: ${sessionId}`);
          transports[sessionId].transport.close();
          delete transports[sessionId];

          // Return error for expired session
          res.status(401).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Session expired',
            },
            id: null,
          });
          return;
        }

        // Reuse existing transport
        transport = transports[sessionId].transport;
        // Update session last access time
        transports[sessionId].lastAccess = Date.now();
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // New initialization request
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: newSessionId => {
            // Store the transport by session ID
            transports[newSessionId] = {
              transport: transport,
              lastAccess: Date.now(),
            };
            console.log(`Session initialized: ${newSessionId}`);
          },
        });

        // Clean up transport when closed
        transport.onclose = () => {
          if (transport.sessionId) {
            console.log(`Session closed: ${transport.sessionId}`);
            delete transports[transport.sessionId];
          }
        };

        const server = new McpServer({
          name: 'example-server',
          version: '1.0.0',
        });

        server.tool(
          'get_pet_vaccination_info',
          'Retrieves the vaccination history and upcoming vaccination dates for a specific pet. Requires user authentication and explicit consent via an authorization token.',
          {
            petId: z.string().describe('The unique identifier for the pet.'),
            authorizationToken: z
              .string()
              .describe("A token representing the user's logged-in session and consent to access this pet's data."),
          },
          async ({petId}) => {
            try {
              // Note: Authentication validation will be added later
              return {
                content: [
                  {
                    type: 'text',
                    text: `Retrieved vaccination info for pet ID: ${petId}`,
                  },
                ],
              };
            } catch (error) {
              console.error(`Error retrieving vaccination info: ${error}`);
              throw new Error(`Failed to retrieve vaccination information`);
            }
          },
        );

        // Tool: Book Vet Appointment
        server.tool(
          'book_vet_appointment',
          'Books a new veterinary appointment for a specific pet. Requires user authentication and explicit consent via an authorization token.',
          {
            petId: z.string().describe('The unique identifier for the pet.'),
            authorizationToken: z
              .string()
              .describe("A token representing the user's logged-in session and consent to access this pet's data."),
            date: z.string().describe('Desired date for the appointment (e.g., YYYY-MM-DD).'),
            time: z.string().describe('Desired time for the appointment (e.g., HH:MM AM/PM).'),
            reason: z.string().describe('The reason for the vet visit.'),
          },
          async ({petId, authorizationToken, date, time, reason}) => {
            try {
              // Note: Authentication validation will be added later
              return {
                content: [
                  {
                    type: 'text',
                    text: `Booked vet appointment for pet ID: ${petId} on ${date} at ${time} for: ${reason}`,
                  },
                ],
              };
            } catch (error) {
              console.error(`Error booking appointment: ${error}`);
              throw new Error(`Failed to book appointment`);
            }
          },
        );

        // Example usage of secure tool
        secureTool(
          server,
          'securedVetAppointment',
          'secured tool that enables authenticated users to book appointments',
          {
            name: z.string(),
            age: z.number().optional(),
          },
          async ({name, age, authContext}) => {
            return {
              content: [
                {
                  type: 'text',
                  text: `Booked vet appointment for pet ID: ${name} with age ${age} using token ${authContext?.token}`,
                },
              ],
            };
          },
        );

        try {
          // Connect to the MCP server
          await server.connect(transport);
          console.log('Server connected to transport');
        } catch (error) {
          console.error(`Error connecting server to transport: ${error}`);
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Internal server error: Failed to connect to MCP server',
            },
            id: null,
          });
          return;
        }
      } else {
        // Invalid request
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: No valid session ID provided',
          },
          id: null,
        });
        return;
      }

      // Handle the request
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error(`Error handling MCP request: ${error}`);
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  },
);

// Reusable handler for GET and DELETE requests
const handleSessionRequest = async (req: express.Request, res: express.Response) => {
  try {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }

    // Check if session has expired
    if (isSessionExpired(transports[sessionId].lastAccess)) {
      console.log(`Session expired: ${sessionId}`);
      transports[sessionId].transport.close();
      delete transports[sessionId];
      res.status(401).send('Session expired');
      return;
    }

    // Update session last access time
    transports[sessionId].lastAccess = Date.now();

    const transport = transports[sessionId].transport;
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error(`Error handling session request: ${error}`);
    res.status(500).send('Internal server error');
  }
};

// Handle GET requests for server-to-client notifications
app.get('/mcp', handleSessionRequest);

// Handle DELETE requests for session termination
app.delete('/mcp', handleSessionRequest);

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MCP server running on port ${PORT}`);
});

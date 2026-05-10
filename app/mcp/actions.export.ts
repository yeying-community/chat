import {
  DEFAULT_MCP_CONFIG,
  ListToolsResponse,
  McpConfigData,
  McpRequestMessage,
  ServerConfig,
  ServerStatusResponse,
} from "./types";

function disabledError() {
  return new Error("MCP is not available in desktop export builds");
}

export async function getClientsStatus(): Promise<
  Record<string, ServerStatusResponse>
> {
  return {};
}

export async function getClientTools(_clientId: string) {
  return null;
}

export async function getAvailableClientsCount() {
  return 0;
}

export async function getAllTools() {
  return [] as { clientId: string; tools: ListToolsResponse | null }[];
}

export async function initializeMcpSystem(): Promise<McpConfigData> {
  return DEFAULT_MCP_CONFIG;
}

export async function addMcpServer(
  _clientId: string,
  _config: ServerConfig,
): Promise<McpConfigData> {
  throw disabledError();
}

export async function pauseMcpServer(
  _clientId: string,
): Promise<McpConfigData> {
  throw disabledError();
}

export async function resumeMcpServer(_clientId: string): Promise<void> {
  throw disabledError();
}

export async function removeMcpServer(
  _clientId: string,
): Promise<McpConfigData> {
  throw disabledError();
}

export async function restartAllClients(): Promise<McpConfigData> {
  throw disabledError();
}

export async function executeMcpAction(
  _clientId: string,
  _request: McpRequestMessage,
) {
  throw disabledError();
}

export async function getMcpConfigFromFile(): Promise<McpConfigData> {
  return DEFAULT_MCP_CONFIG;
}

export async function isMcpEnabled(): Promise<boolean> {
  return false;
}

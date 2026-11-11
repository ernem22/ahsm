// Offline stand-in for `npx add-mcp`: adds one entry to the harness MCP config.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const target = process.argv[2] ?? 'unknown';
const name = process.argv[3] ?? target;
const file = path.join(os.homedir(), '.fake', 'mcp.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { mcpServers: {} };
config.mcpServers ??= {};
config.mcpServers[name] = { target };
fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf8');
console.log(`added ${name}`);

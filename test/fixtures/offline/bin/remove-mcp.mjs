// Offline stand-in for `npx add-mcp remove`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const name = process.argv[2] ?? '';
const file = path.join(os.homedir(), '.fake', 'mcp.json');
if (fs.existsSync(file)) {
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete config.mcpServers?.[name];
  fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf8');
}
console.log(`removed ${name}`);

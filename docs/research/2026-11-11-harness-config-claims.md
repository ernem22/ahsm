# Harness config claims — primary-source verification (2026-11-11)

> Note: this repo has no research-notes convention yet (`docs/` holds only `adr/` and `agents/`); `docs/research/` was created for this file. Repo branch: `feat/harnesses-and-remove`. `skills` v1.8.1, `add-mcp` 2.6.1, claude 2.1.322, codex-cli 0.166.0, pi 1.4.0, opencode 1.19.0.

| Claim | Verdict | Evidence (one line) |
|---|---|---|
| C1 | CONFIRMED | `AgentInfo` has exactly `id,name,projectSkillsDir,globalSkillsDir,universal` |
| C2 | CONTRADICTED | `pi mcp list --json` emits `"source": "...\.pi\agent\mcp.json"`; `codex doctor` prints `config.toml C:\Users\zurza\.codex\config.toml` |
| C3 | CONFIRMED | all four paths + keys read and quoted below |
| C4 | PARTIAL | skills uses `pi` (no `pi-agent`); `pi-agent` exists only as an add-mcp alias |
| C5 | CONFIRMED | `~/.agents/.skill-lock.json`, `skills[*].source = "owner/repo"` (18 `emilkowalski/skills` entries) |
| C6 | CONFIRMED | `-a` lists all four; `remove` without `-a` passes `agents: undefined` → all configs |

## C1 — CONFIRMED

`node_modules/skills/dist/index.d.mts:636-650`:

```ts
interface AgentInfo {
  readonly id: string;
  readonly name: string;
  readonly projectSkillsDir: string;
  readonly globalSkillsDir: string | null;
  readonly universal: boolean;
}
interface DetectAgentsResult { readonly agents: readonly AgentInfo[]; }  // :651-654
```

No MCP/hooks fields. `docs/agents.md` mentions "Hooks" only in a *skills feature compatibility* table (per-agent skill capabilities), not as part of `AgentInfo`. Runtime check at the repo root:

```
node -e "…getSupportedAgents()…"
COUNT 79
claude-code {"id":"claude-code","name":"Claude Code","projectSkillsDir":".claude/skills","globalSkillsDir":"C:\Users\zurza\.claude\skills","universal":false}
codex  {"id":"codex","projectSkillsDir":".agents/skills","globalSkillsDir":"C:\Users\zurza\.agents\skills","universal":true}
opencode {"id":"opencode",…"globalSkillsDir":"C:\Users\zurza\.config\opencode\skills","universal":true}
pi {"id":"pi",…"globalSkillsDir":"C:\Users\zurza\.agents\skills","universal":true}
pi-agent undefined
```

## C2 — CONTRADICTED

- `claude mcp list --json` → `error: unknown option '--json'`. `claude mcp list --help` offers only `-h`. Plain `claude mcp list` prints `name: url - status` lines, no file path.
- `codex mcp list --json` → JSON array with `name/enabled/transport/env/cwd/timeouts`; **no config path** (grep for `*config*` keys: no match). `codex mcp get <name> --json` likewise.
- **Counterexample 1:** `pi mcp list --json` → `"source": "C:\Users\zurza\.pi\agent\mcp.json"`. `pi mcp --help` also states *"Reads ~/.pi/agent/mcp.json and, in trusted projects, .pi/mcp.json."*
- **Counterexample 2:** `codex doctor` → `config.toml   C:\Users\zurza\.codex\config.toml`.
- `opencode mcp list` → box UI with server + command path only; `--help` for `mcp`/`mcp list`/`mcp add` exposes no path or `--json` flag.

So the correct statement is: *claude and opencode expose no config path; codex exposes it only via `codex doctor`; pi exposes it via `mcp list --json` and its help text.*

## C3 — CONFIRMED

| Harness | File | Key (quoted) |
|---|---|---|
| claude-code | `~/.claude.json` | top-level `"mcpServers"` → `["serena","context7"]` |
| codex | `~/.codex/config.toml` | `[mcp_servers.node_repl]` (line 102), `[mcp_servers.node_repl.env]` (108) |
| pi | `~/.pi/agent/mcp.json` | top-level keys `["mcpServers"]` → `["context7","deepwiki","sentry","playwright"]` |
| opencode | `~/.config/opencode/opencode.jsonc` | `"mcp": { "paper": { "type":"local", "command":[…], "enabled":true } }` (line 47); `grep -c mcpServers` → `0` |

Codex `[mcp_servers.node_repl]` uses `args = []`, `command = '…node_repl.exe'`, `env_vars = [...]`, `startup_timeout_sec = 120` — TOML confirmed. No tokens in these excerpts; values redacted as `*` by the CLIs themselves.

## C4 — PARTIAL

- `skills` ids are exactly `claude-code`, `codex`, `opencode`, `pi` (`getSupportedAgents()` above; `docs/agents.md` table).
- `pi-agent` does **not** exist in the skills package: `grep -c pi-agent node_modules/skills/dist/index.mjs` → `0`; same for `docs/agents.md` → `0`.
- `npx add-mcp list-agents` row: `pi   Pi   pi-agent   ✓ ✓` (alias lives in add-mcp, not skills).
- `npx skills add --help` takes `-a, --agent <agents>` (no inline enumeration of ids).

## C5 — CONFIRMED

`~/.agents/.skill-lock.json` (40042 bytes): top-level keys `["version","skills","dismissed","lastSelectedAgents"]`, `version: 3`, 101 skill entries. Sample entry `ask-matt` keys:

```
source: "mattpocock/skills", sourceType: "github",
sourceUrl: "https://github.com/mattpocock/skills.git",
skillPath: "skills/engineering/ask-matt/SKILL.md",
skillFolderHash: "…", installedAt, updatedAt
```

Top sources by count: `mattpocock/skills` (37), `emilkowalski/skills` (18), `getsentry/skills` (8). So `owner/repo` format holds and the `emilkowalski/skills` example is present (36 raw `emilkowalski` matches).

## C6 — CONFIRMED

`npx add-mcp --help`: `-a, --agent <agent> Specify agents to install to`. `add-mcp list-agents` lists `claude-code`, `codex`, `opencode`, `pi` (alias `pi-agent`) with both Local and Global `✓`. `add-mcp remove --help`: `-g, --global`, `-a, --agent <agent>  Filter to specific agent(s) (default: [])`, `-y, --yes`. Source `dist/index.js:1350-1357`: `listInstalledServers({ global, agents: explicitAgents.length > 0 ? explicitAgents : void 0 })` — no `-a` ⇒ scans all agent configs ⇒ removes from every agent (interactive unless `-y`). Caveat at `:1373`: `.mcp.json` is shared by Claude Code and GitHub Copilot CLI, so removing there affects both.

## What remains unverified

1. Vendor **docs** were not fetched; only CLI output/help was used. Whether a documented path-printing flag exists for claude/opencode (e.g. a `--debug`/`doctor` equivalent) needs `code.claude.com/docs/en/mcp` and `opencode.ai/docs/mcp-servers`.
2. claude's actual MCP source is not proven to be `~/.claude.json` alone — plugins (`plugin:design:*`) and `.mcp.json` also feed `claude mcp list`; no CLI output ties servers to that file.
3. `skills` `--json` output shape for `detectAgents` was not exercised end-to-end (only the type declaration + `getSupportedAgents()`).
4. `add-mcp remove` "every agent" was verified from source, not by running a real removal (destructive).

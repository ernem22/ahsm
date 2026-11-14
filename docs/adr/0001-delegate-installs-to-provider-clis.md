# Delegate skills and MCP installs to their own CLIs

Skills and MCP servers are installed by calling the tools that already own them (`npx skills`,
`npx add-mcp`); ahsm writes only hooks. The alternative — writing skill files and MCP config
entries ourselves — would mean re-implementing symlink-vs-copy, per-harness paths, update and remove
semantics, and the lockfiles those tools maintain. Deciding this the other way would have made
ahsm a package manager; the value we actually want is one package list spanning three item types
and four harnesses, plus a single honest view of what is installed where.

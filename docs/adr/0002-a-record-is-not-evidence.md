# A record is not evidence

"Already installed" is only reported when the provider's own inventory confirms it (the skills
lockfile, the harness's MCP config); with no way to verify, ahsm installs again rather than
trusting its own record. The alternative — trusting `state.json` — meant a skill deleted by hand kept
being reported as installed and was never restored, which is the failure the whole tool exists to
prevent. Installing twice is cheap because the provider commands are idempotent; lying is not.

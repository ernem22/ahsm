import type { Ctx } from '../context.js';
import type { Data } from '../types.js';

/**
 * The scope we ask a provider's inventory for. Every provider installs at user level today (`-g` is
 * fixed in its argv), so this is the only scope that can come back. When project scope lands, the
 * adapter reports the scope per skill and this constant becomes a field read off the inventory.
 */
export const INVENTORY_SCOPE = 'user' as const;

export type InventoryScope = typeof INVENTORY_SCOPE;

/** One installed skill, straight from the provider's inventory — not from anything we recorded. */
export interface SkillInventoryRow {
  name: string;
  scope: InventoryScope;
  source?: string;
  /** Harness definitions whose `agentId` the provider reported carrying this skill. */
  harnesses: string[];
  /** Provider agent ids with no harness definition here; kept as the provider names them. */
  otherAgents: string[];
}

export interface SkillInventoryReport {
  rows: SkillInventoryRow[];
}

/**
 * Read-only: asks the skills provider what is actually installed, so skills installed outside agentenv
 * appear too (a record is not evidence — ADR-0002). Reads `state.json` at no point: a damaged record
 * cannot make the picture incomplete, and nothing is written, not even a backup.
 *
 * `listSkills()` costs ~7 s per hundred skills, which is why this is only reachable from `agentenv list`
 * and never from `plan` or `status` (whose contract is fast and side-effect free).
 */
export async function readSkillInventory(data: Data, ctx: Ctx): Promise<SkillInventoryReport> {
  const harnessOfAgent = new Map<string, string>();
  for (const harness of data.harnesses) {
    if (harness.agentId) harnessOfAgent.set(harness.agentId, harness.id);
  }

  const installed = await ctx.skills.list();
  const rows = installed
    .map((skill) => {
      const harnesses = new Set<string>();
      const otherAgents = new Set<string>();
      for (const agent of skill.agents) {
        const harness = harnessOfAgent.get(agent);
        if (harness) harnesses.add(harness);
        else otherAgents.add(agent);
      }
      return {
        name: skill.name,
        scope: INVENTORY_SCOPE,
        ...(skill.source ? { source: skill.source } : {}),
        harnesses: [...harnesses].sort(),
        otherAgents: [...otherAgents].sort(),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { rows };
}

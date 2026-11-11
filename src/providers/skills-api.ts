import type { Kind } from '../types.js';

export interface SkillsAdapterInstall {
  installed: string[];
  failed: { skill: string; message: string }[];
}

export interface SkillsAdapterRemove {
  removed: string[];
  notFound: string[];
  failed: { skill: string; message: string }[];
}

export interface InstalledSkill {
  name: string;
  source?: string;
  agents: string[];
}

/**
 * The `skills` package's programmatic surface, behind one interface so the rest of the code never
 * imports it directly: tests inject a stub, and a Node without the package degrades to a clear error.
 */
export interface SkillsAdapter {
  install(input: { source: string; skills?: string[]; agents: string[] }): Promise<SkillsAdapterInstall>;
  remove(input: { names: string[]; agents?: string[] }): Promise<SkillsAdapterRemove>;
  list(): Promise<InstalledSkill[]>;
}

export class SkillsUnavailableError extends Error {
  readonly kind: Kind = 'skill';
  constructor(cause?: unknown) {
    super(`the skills API is unavailable (${cause instanceof Error ? cause.message : String(cause)})`);
    this.name = 'SkillsUnavailableError';
  }
}

/** Real adapter: loads `skills` lazily so a CLI-only machine can still plan an MCP/hook install. */
export function createSkillsAdapter(): SkillsAdapter {
  const load = async () => {
    try {
      return await import('skills');
    } catch (error) {
      throw new SkillsUnavailableError(error);
    }
  };

  return {
    async install({ source, skills, agents }) {
      const api = await load();
      const result = await api.installSkills(source, { scope: 'global', agents, ...(skills ? { skills } : {}) });
      return {
        installed: result.installed.map((target) => target.skill),
        failed: result.failed.map((failure) => ({
          skill: failure.skill ?? source,
          message: failure.message ?? String(failure.code ?? 'install failed'),
        })),
      };
    },

    async remove({ names, agents }) {
      const api = await load();
      const result = await api.removeSkills(names, { scope: 'global', ...(agents ? { agents } : {}) });
      return {
        removed: [...result.removed],
        notFound: [...result.notFound],
        failed: result.failed.map((failure) => ({ skill: failure.skill, message: failure.message })),
      };
    },

    async list() {
      const api = await load();
      const result = await api.listSkills({ scope: 'global' });
      return result.skills.map((skill) => ({ name: skill.name, source: skill.source, agents: [...skill.agents] }));
    },
  };
}

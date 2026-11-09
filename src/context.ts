import { spawn } from 'node:child_process';
import path from 'node:path';
import { t } from './i18n.js';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface Runner {
  run(argv: string[]): Promise<RunResult>;
}

export interface Ctx {
  /** User home; every harness path resolves from here so tests can fake it. */
  home: string;
  /** Package root holding catalog/, packages/, harnesses/, providers/, requires/. */
  root: string;
  platform: NodeJS.Platform;
  runner: Runner;
  now: () => Date;
  log: (line: string) => void;
}

/** Real process runner. On Windows `npx` needs a shell to resolve `npx.cmd`. */
export class ProcessRunner implements Runner {
  constructor(private readonly cwd?: string) {}

  run(argv: string[]): Promise<RunResult> {
    const [cmd, ...args] = argv;
    if (!cmd) return Promise.resolve({ code: 1, stdout: '', stderr: t.emptyCommand });

    return new Promise((resolve) => {
      const child = spawn(cmd, args, {
        cwd: this.cwd,
        shell: process.platform === 'win32',
        env: process.env,
      });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('error', (err) => resolve({ code: 1, stdout, stderr: `${stderr}${String(err)}` }));
      child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    });
  }
}

/** A runner that records commands instead of executing them (used by tests). */
export class RecordingRunner implements Runner {
  readonly calls: string[][] = [];
  constructor(private readonly results: RunResult[] = []) {}

  async run(argv: string[]): Promise<RunResult> {
    this.calls.push(argv);
    return this.results.shift() ?? { code: 0, stdout: '', stderr: '' };
  }
}

export function expandPath(p: string, home: string): string {
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(home, p.slice(2));
  return p;
}

export function createContext(overrides: Partial<Ctx> = {}): Ctx {
  return {
    home: overrides.home ?? process.env.HOME ?? process.env.USERPROFILE ?? '',
    root: overrides.root ?? process.cwd(),
    platform: overrides.platform ?? process.platform,
    runner: overrides.runner ?? new ProcessRunner(),
    now: overrides.now ?? (() => new Date()),
    log: overrides.log ?? (() => {}),
  };
}

/** Turns an argv template into a concrete argv: empty placeholders drop the element. */
export function expandArgs(template: string[], vars: Record<string, string | undefined>): string[] {
  const out: string[] = [];
  for (const element of template) {
    const names = [...element.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string);
    if (names.some((name) => !vars[name])) continue;
    const filled = element.replace(/\{(\w+)\}/g, (_all, name: string) => vars[name] as string);
    if (filled.includes(' ')) out.push(...filled.split(' ').filter(Boolean));
    else out.push(filled);
  }
  return out;
}

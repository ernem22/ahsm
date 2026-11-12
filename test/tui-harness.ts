import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { render } from 'ink';
import { createContext, RecordingRunner, type Ctx } from '../src/context.js';
import { loadData } from '../src/data.js';
import { App } from '../src/tui/App.js';
import type { Data } from '../src/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The offline data root the e2e scripts use: one fake harness, two packages, no network. */
export const OFFLINE_ROOT = path.join(here, 'fixtures', 'offline');

/** Escape sequences Ink emits for colour, bold and dim; the frame is asserted as plain text. */
const ANSI = /\u001B\[[0-9;?]*[ -/]*[@-~]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

/** Captures one chunk per rendered frame; `columns` is the terminal width the frame is laid out for. */
export class CapturingStdout extends Writable {
  readonly chunks: string[] = [];
  readonly columns: number;
  readonly rows: number;
  isTTY = false;

  constructor(columns: number, rows = 30) {
    super();
    this.columns = columns;
    this.rows = rows;
  }

  override _write(chunk: unknown, _encoding: BufferEncoding, done: (error?: Error | null) => void): void {
    this.chunks.push(String(chunk));
    done();
  }
}

/** A keyboard with the TTY bits stubbed: Ink reads it, so a test writes keys instead of a user. */
class FakeStdin extends PassThrough {
  isTTY = true;
  setRawMode(): void {}
}

/** One millisecond of real time, long enough for Ink's 20 ms lone-Escape flush to land. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 35));

export interface TuiOptions {
  data: Data;
  ctx: Ctx;
  width: number;
  rows?: number;
}

export interface TuiHarness {
  /** The last rendered frame, ANSI stripped. */
  frame(): string;
  /** The last frame as lines with trailing blanks trimmed. */
  lines(): string[];
  press(...keys: string[]): Promise<void>;
  /** Settles when the app leaves, which never happens on its own. */
  waitUntilExit(): Promise<void>;
  stop(): Promise<void>;
}

export async function startTui(options: TuiOptions): Promise<TuiHarness> {
  const stdout = new CapturingStdout(options.width, options.rows ?? 30);
  const stdin = new FakeStdin();
  const instance = render(React.createElement(App, { data: options.data, ctx: options.ctx }), {
    stdin,
    stdout,
    stderr: new CapturingStdout(options.width),
    debug: true,
    patchConsole: false,
    exitOnCtrlC: false,
  });
  await settle();

  const frames = (): string[] =>
    stdout.chunks.map(stripAnsi).filter((chunk) => chunk.trim() !== '' && chunk !== '\n');
  const frame = (): string => frames()[frames().length - 1] ?? '';

  return {
    frame,
    lines: () => frame().split('\n').map((line) => line.replace(/\s+$/, '')),
    async press(...keys) {
      for (const key of keys) {
        stdin.write(key);
        await settle();
      }
    },
    async waitUntilExit() {
      await instance.waitUntilExit();
    },
    async stop() {
      instance.unmount();
      await settle();
    },
  };
}

/** A disposable home; `detected: true` plants the fixture harness's detect path in it. */
export function fixtureHome(detected = false): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentenv-tui-'));
  if (detected) fs.mkdirSync(path.join(home, '.fake'), { recursive: true });
  return home;
}

/** The real app's data and context, pointed at the offline fixtures and a fake home. */
export function fixture(detected = false): { data: Data; ctx: Ctx } {
  const home = fixtureHome(detected);
  return {
    data: loadData(OFFLINE_ROOT),
    ctx: createContext({ home, root: OFFLINE_ROOT, runner: new RecordingRunner() }),
  };
}

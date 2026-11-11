#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, type Ctx } from './context.js';
import { loadData } from './data.js';
import { applyPlan, exitCodeFor, type ApplyOutcome } from './core/apply.js';
import { buildPlan, type Plan, type PlanAction } from './core/plan.js';
import { resolveSelection } from './core/selection.js';
import { applyRemovePlan, buildRemovePlan } from './core/remove.js';
import { readStatus } from './core/status.js';
import { readSkillInventory } from './core/list.js';
import { readStaleSkills } from './core/stale.js';
import { t } from './i18n.js';
import { listLines, outcomeLines, planLines, removeOutcomeLines, removePlanLines, staleLines, statusLines } from './render.js';
import type { Data } from './types.js';

/** `AGENTENV_ROOT` points the CLI at another data root (fixtures, e2e sandboxes). */
const root = process.env.AGENTENV_ROOT
  ? path.resolve(process.env.AGENTENV_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function printPlan(plan: Plan): void {
  console.log(`
${t.plan}`);
  for (const line of planLines(plan)) console.log(line.text);
  console.log('');
}

function printOutcome(outcome: ApplyOutcome): void {
  for (const line of outcomeLines(outcome)) console.log(line.text);
}

async function printStatus(data: Data, ctx: Ctx): Promise<void> {
  const report = await readStatus(data, ctx);
  for (const line of statusLines(report)) console.log(line.text);
}

/** `agentenv list`: an explicit, read-only read of the provider's inventory (never plan or status). */
async function printInventory(data: Data, ctx: Ctx): Promise<void> {
  const report = await readSkillInventory(data, ctx);
  for (const line of listLines(report)) console.log(line.text);
}

/** `agentenv stale`: the provider's own update check, read-only — nothing is installed, nothing written. */
async function printStale(data: Data, ctx: Ctx): Promise<void> {
  const report = await readStaleSkills(data, ctx);
  for (const line of staleLines(report)) console.log(line.text);
}

function valueOf(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function selectionFromArgs(data: Data, ctx: Ctx, argv: string[]) {
  const harnessFlag = valueOf(argv, '--harness');
  return resolveSelection(data, ctx, {
    packageId: valueOf(argv, '--package'),
    harnessIds: harnessFlag ? harnessFlag.split(',').map((id) => id.trim()) : undefined,
  });
}

/** `--update` absent or `none` marks nothing; `all` marks every offer; a list names the ones to run. */
function markedUpdates(argv: string[], plan: Plan): string[] {
  const flag = valueOf(argv, '--update');
  if (!flag || flag === 'none') return [];
  if (flag === 'all') return plan.requirements.map((requirement) => requirement.id);
  return flag
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h') || argv[0] === 'help') {
    for (const line of t.help) console.log(line);
    return;
  }
  const command = argv.find((arg) => !arg.startsWith('-')) ?? 'tui';
  const ctx = createContext({ root });
  const data = loadData(root);

  if (command === 'plan') {
    printPlan(await buildPlan(data, ctx, selectionFromArgs(data, ctx, argv)));
    return;
  }

  if (command === 'apply') {
    const plan = await buildPlan(data, ctx, selectionFromArgs(data, ctx, argv));
    if (!argv.includes('--yes')) {
      printPlan(plan);
      console.log(t.applyHint);
      return;
    }
    const outcome = await applyPlan(data, ctx, plan, { updates: markedUpdates(argv, plan) });
    printOutcome(outcome);
    process.exitCode = exitCodeFor(outcome);
    return;
  }

  if (command === 'remove') {
    const packageId = valueOf(argv, '--package');
    const pkg = packageId ? data.packages.get(packageId) : undefined;
    if (packageId && !pkg) throw new Error(t.packageNotFound(packageId));
    const plan = buildRemovePlan(data, ctx, pkg?.items);
    if (!argv.includes('--yes')) {
      console.log(`
${t.removeTitle}`);
      for (const line of removePlanLines(plan)) console.log(line.text);
      console.log(t.removeHint);
      return;
    }
    const outcome = await applyRemovePlan(data, ctx, plan);
    for (const line of removeOutcomeLines(outcome)) console.log(line.text);
    process.exitCode = outcome.results.some((result) => result.status === 'error') ? 1 : 0;
    return;
  }

  if (command === 'status') {
    await printStatus(data, ctx);
    return;
  }

  if (command === 'list') {
    await printInventory(data, ctx);
    return;
  }

  if (command === 'stale') {
    await printStale(data, ctx);
    return;
  }

  const { renderApp } = await import('./tui/App.js');
  await renderApp(data, ctx);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

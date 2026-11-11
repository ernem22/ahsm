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
import { t } from './i18n.js';
import { outcomeLines, planLines, removeOutcomeLines, removePlanLines } from './render.js';
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

function printStatus(data: Data, ctx: Ctx): void {
  const report = readStatus(data, ctx);
  for (const warning of report.warnings) console.log(`! ${warning}`);
  if (report.rows.length === 0) {
    console.log(t.statusEmpty);
    return;
  }
  for (const row of report.rows) {
    const detail = row.detail ? ` — ${row.detail}` : '';
    console.log(`${t.statusLabels[row.value]}  ${row.itemId} → ${row.harness} [${row.kind}]${detail}`);
  }
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
    const outcome = await applyPlan(data, ctx, plan);
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
    printStatus(data, ctx);
    return;
  }

  const { renderApp } = await import('./tui/App.js');
  await renderApp(data, ctx);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

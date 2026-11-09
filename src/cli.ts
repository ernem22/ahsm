#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, type Ctx } from './context.js';
import { loadData } from './data.js';
import { applyPlan, type ApplyOutcome } from './core/apply.js';
import { buildPlan, type Plan, type PlanAction } from './core/plan.js';
import { resolveSelection } from './core/selection.js';
import { readStatus } from './core/status.js';
import { t } from './i18n.js';
import type { Data } from './types.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ACTION_MARK: Record<PlanAction, string> = { run: '+', already: '=', unsupported: '!', error: '!' };

function printPlan(plan: Plan): void {
  console.log(`\n${t.plan}`);
  for (const entry of plan.entries) {
    console.log(`${ACTION_MARK[entry.action]} ${entry.itemId} → ${entry.harness} [${entry.kind}/${entry.providerId ?? '-'}]`);
    if (entry.command) console.log(`    ${t.runPrefix}: ${entry.command.join(' ')}`);
    if (entry.writes) console.log(`    ${t.writePrefix}: ${entry.writes}`);
    if (entry.adds) console.log(`    ${t.hookEntry}: ${entry.adds}`);
    if (entry.reason) console.log(`    ${t.notePrefix}: ${entry.reason}`);
  }
  for (const requirement of plan.requirements) {
    const mark = requirement.present ? '=' : '+';
    const hint = requirement.present ? '' : ` → ${requirement.installCommand?.join(' ') ?? t.notDefined}`;
    console.log(`${mark} ${t.requirement} ${requirement.id}${hint}`);
  }
  for (const warning of plan.warnings) console.log(`! ${warning}`);
  const runs = plan.entries.filter((entry) => entry.action === 'run').length;
  console.log(`\n${t.actions(runs, plan.entries.length - runs)}\n`);
}

function printOutcome(outcome: ApplyOutcome): void {
  for (const requirement of outcome.requirements) {
    if (!requirement.ok) console.log(`! ${t.requirementFailed(requirement.id, requirement.message ?? t.missing)}`);
  }
  for (const result of outcome.items) {
    const suffix = result.message ? ` (${result.message})` : '';
    console.log(`${t.applyLabels[result.status]}  ${result.entry.itemId} → ${result.entry.harness}${suffix}`);
  }
}

function printStatus(data: Data, ctx: Ctx): void {
  const rows = readStatus(data, ctx);
  if (rows.length === 0) {
    console.log(t.statusEmpty);
    return;
  }
  for (const row of rows) {
    const label = t.statusLabels[row.value] ?? row.value;
    const detail = row.detail ? ` — ${row.detail}` : '';
    console.log(`${label}  ${row.itemId} → ${row.harness} [${row.kind}]${detail}`);
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
  const command = argv.find((arg) => !arg.startsWith('-')) ?? 'tui';
  const ctx = createContext({ root });
  const data = loadData(root);

  if (command === '--help' || command === 'help') {
    for (const line of t.help) console.log(line);
    return;
  }

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
    printOutcome(await applyPlan(data, ctx, plan));
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

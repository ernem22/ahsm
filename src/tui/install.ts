import type { Ctx } from '../context.js';
import { detectHarnesses } from '../core/detect.js';
import { defaultPackageId, resolveSelection } from '../core/selection.js';
import { t } from '../i18n.js';
import type { Data, ItemDef } from '../types.js';

export const STAGES = ['harnesses', 'package', 'items'] as const;
export type Stage = (typeof STAGES)[number];

export interface HarnessRow {
  id: string;
  label: string;
  present: boolean;
}

export interface PackageRow {
  id: string;
  note?: string;
  link?: string;
  itemIds: string[];
}

/**
 * Everything the install surface knows, resolved once when the window opens. The shell owns it, so
 * leaving the surface for another one and coming back keeps every choice the user has made.
 */
export interface InstallForm {
  stage: Stage;
  harnesses: HarnessRow[];
  /** Chosen harness ids, in row order. */
  harnessIds: string[];
  packages: PackageRow[];
  packageId: string;
  /** Chosen item ids of the chosen package, in that package's own order. */
  itemIds: string[];
  cursors: Record<Stage, number>;
}

/** The rows come from the same detection and the same data the CLI reads; nothing is repeated here. */
export function installRows(data: Data, ctx: Ctx): Pick<InstallForm, 'harnesses' | 'packages'> {
  return {
    harnesses: detectHarnesses(data, ctx).map((harness) => ({
      id: harness.def.id,
      label: harness.def.label ?? harness.def.id,
      present: harness.present,
    })),
    packages: [...data.packages.values()].map((pkg) => ({
      id: pkg.id,
      note: pkg.note,
      link: pkg.link,
      itemIds: pkg.items,
    })),
  };
}

/** The window opens on the selection the CLI would make with no flags: default package, detected harnesses. */
export function initialForm(data: Data, ctx: Ctx): InstallForm {
  const rows = installRows(data, ctx);
  const packageId = defaultPackageId(data) ?? '';
  const selection = packageId ? resolveSelection(data, ctx) : { harnessIds: [], itemIds: [] };
  return {
    stage: 'harnesses',
    ...rows,
    harnessIds: selection.harnessIds,
    packageId,
    itemIds: selection.itemIds,
    cursors: { harnesses: 0, package: rows.packages.findIndex((row) => row.id === packageId), items: 0 },
  };
}

export function chosenPackage(form: InstallForm): PackageRow | undefined {
  return form.packages.find((row) => row.id === form.packageId);
}

/** The rows the focused section prints, so every action can clamp its cursor against them. */
export function sectionSize(form: InstallForm): number {
  if (form.stage === 'harnesses') return form.harnesses.length;
  if (form.stage === 'package') return form.packages.length;
  return chosenPackage(form)?.itemIds.length ?? 0;
}

/** The item definitions behind the chosen package, in its order. */
export function packageItems(data: Data, form: InstallForm): ItemDef[] {
  return (chosenPackage(form)?.itemIds ?? [])
    .map((id) => data.items.get(id))
    .filter((item): item is ItemDef => item !== undefined);
}

function atStage(form: InstallForm, stage: Stage): InstallForm {
  return { ...form, stage };
}

/** `space`: one row of the focused section, whichever section that is. */
export function toggleFocused(form: InstallForm): InstallForm {
  const cursor = form.cursors[form.stage];
  if (form.stage === 'harnesses') {
    const row = form.harnesses[cursor];
    if (!row) return form;
    const chosen = form.harnessIds.includes(row.id);
    const harnessIds = form.harnesses
      .map((harness) => harness.id)
      .filter((id) => (id === row.id ? !chosen : form.harnessIds.includes(id)));
    return { ...form, harnessIds };
  }
  if (form.stage === 'package') {
    const pkg = form.packages[cursor];
    if (!pkg) return form;
    return { ...form, packageId: pkg.id, itemIds: [...pkg.itemIds] };
  }
  const pkg = chosenPackage(form);
  const id = pkg?.itemIds[cursor];
  if (!pkg || id === undefined) return form;
  const chosen = form.itemIds.includes(id);
  const itemIds = pkg.itemIds.filter((itemId) => (itemId === id ? !chosen : form.itemIds.includes(itemId)));
  return { ...form, itemIds };
}

/** `a`: every row of the focused section at once, or none when they are all already chosen. */
export function toggleSection(form: InstallForm): InstallForm {
  if (form.stage === 'harnesses') {
    const all = form.harnesses.map((row) => row.id);
    return { ...form, harnessIds: form.harnessIds.length === all.length ? [] : all };
  }
  const pkg = chosenPackage(form);
  if (!pkg) return form;
  return { ...form, itemIds: form.itemIds.length === pkg.itemIds.length ? [] : [...pkg.itemIds] };
}

/** `Up`/`Down`: the cursor of the focused section, kept inside it. */
export function moveCursor(form: InstallForm, delta: number): InstallForm {
  const size = sectionSize(form);
  if (size === 0) return form;
  const next = Math.min(Math.max(form.cursors[form.stage] + delta, 0), size - 1);
  return { ...form, cursors: { ...form.cursors, [form.stage]: next } };
}

export type Advance =
  | { kind: 'refused'; message: string }
  | { kind: 'stage'; form: InstallForm }
  | { kind: 'plan' };

/**
 * `Enter`: one section forward. An empty section keeps the stage and the reason, so the key is never
 * dead; past the items section the flow continues on the plan surface.
 */
export function advance(form: InstallForm): Advance {
  if (form.stage === 'harnesses' && form.harnessIds.length === 0) {
    return { kind: 'refused', message: t.tui.nothingChosenHarness };
  }
  if (form.stage === 'items' && form.itemIds.length === 0) {
    return { kind: 'refused', message: t.tui.nothingChosenItem };
  }
  const next = STAGES[STAGES.indexOf(form.stage) + 1];
  if (!next) return { kind: 'plan' };
  return { kind: 'stage', form: atStage(form, next) };
}

/** `Esc`: one section back, along the same path `Enter` came by. */
export function stepBack(form: InstallForm): InstallForm {
  const previous = STAGES[STAGES.indexOf(form.stage) - 1];
  return previous ? atStage(form, previous) : form;
}

import React from 'react';
import { Box, Text } from 'ink';
import { t } from '../i18n.js';
import type { Data, ItemDef } from '../types.js';
import { fitSegments, pad, type Segment } from './format.js';
import { STAGES, chosenPackage, type InstallForm, type PackageRow, type Stage } from './install.js';
import { rowsInView } from './window.js';

/** Below this many columns a row's detail moves to its own indented line instead of its right end. */
export const NARROW_WIDTH = 60;

/**
 * What the focused section's window may not use: the blank line above each of the three sections,
 * their three headings, and the two one-line summaries the unfocused sections fold to.
 */
export const INSTALL_CHROME = 8;

const SEPARATOR = t.tui.detailSeparator;
/** The parts of an item row that say which of two items of the same kind this one is. */
function itemDetail(item: ItemDef): string[] {
  const parts: string[] = [];
  if (item.kind === 'skill' && item.source) parts.push(`${t.tui.sourcePrefix} ${item.source}`);
  if (item.kind === 'mcp') {
    if (item.url) parts.push(`${t.tui.urlPrefix} ${item.url}`);
    else if (item.package) parts.push(`${t.tui.packagePrefix} ${item.package}`);
  }
  if (item.kind === 'hook' && item.event) {
    parts.push([item.event, item.matcher].filter(Boolean).join(t.tui.partSeparator));
  }
  if (item.note) parts.push(`${t.notePrefix}: ${item.note}`);
  return parts;
}

function packageDetail(row: PackageRow): string[] {
  const parts: string[] = [];
  if (row.note) parts.push(`${t.notePrefix}: ${row.note}`);
  if (row.link) parts.push(`${t.tui.linkPrefix} ${row.link}`);
  return parts;
}

/** The chosen mark of a row: a box, never only a colour. */
function box(chosen: boolean): string {
  return chosen ? t.tui.marks.chosen : t.tui.marks.unchosen;
}

/** The focused row is the only one that leads with `>`, in every section and at every width. */
function line(segments: Segment[], width: number): Segment[] {
  return fitSegments(segments, width);
}

/** A row plus its detail: on one line when there is room, under itself with an indent when there is not. */
function rowLines(lead: Segment[], detail: string[], width: number): Segment[][] {
  if (detail.length === 0) return [line(lead, width)];
  if (width < NARROW_WIDTH) {
    return [line(lead, width), ...detail.map((part) => line([{ text: SEPARATOR }, { text: part, dim: true }], width))];
  }
  return [line([...lead, { text: SEPARATOR }, { text: detail.join(SEPARATOR), dim: true }], width)];
}

/** One row of the focused section before it is laid out: its lead segments and the detail after them. */
interface Row {
  lead: Segment[];
  detail: string[];
}

function harnessRows(form: InstallForm, width: number): Row[] {
  const labelWidth = Math.max(0, ...form.harnesses.map((row) => row.label.length));
  return form.harnesses.map((row, index) => ({
    lead: [
      { text: index === form.cursors.harnesses ? t.tui.marks.focused : t.tui.marks.blank },
      { text: box(form.harnessIds.includes(row.id)) },
      { text: width < NARROW_WIDTH ? row.label : pad(row.label, labelWidth) },
    ],
    detail: row.present ? [] : [t.tui.notDetected],
  }));
}

function packageRows(form: InstallForm, width: number): Row[] {
  const idWidth = Math.max(0, ...form.packages.map((row) => row.id.length)) + 3;
  return form.packages.map((row, index) => ({
    lead: [
      { text: index === form.cursors.package ? t.tui.marks.focused : t.tui.marks.blank },
      { text: box(row.id === form.packageId) },
      { text: width < NARROW_WIDTH ? row.id : pad(row.id, idWidth) },
    ],
    detail: packageDetail(row),
  }));
}

function itemRows(data: Data, form: InstallForm, width: number): Row[] {
  const pkg = chosenPackage(form);
  const items = (pkg?.itemIds ?? [])
    .map((id) => data.items.get(id))
    .filter((item): item is ItemDef => item !== undefined);
  const idWidth = Math.max(0, ...items.map((item) => item.id.length)) + 3;
  const kindWidth = Math.max(0, ...items.map((item) => item.kind.length));
  return items.map((item, index) => ({
    lead:
      width < NARROW_WIDTH
        ? [
            { text: index === form.cursors.items ? t.tui.marks.focused : t.tui.marks.blank },
            { text: box(form.itemIds.includes(item.id)) },
            { text: `${item.id}  ${item.kind}` },
          ]
        : [
            { text: index === form.cursors.items ? t.tui.marks.focused : t.tui.marks.blank },
            { text: box(form.itemIds.includes(item.id)) },
            { text: pad(item.id, idWidth) },
            { text: pad(item.kind, kindWidth), dim: true },
          ],
    detail: itemDetail(item),
  }));
}

function sectionRows(stage: Stage, data: Data, form: InstallForm, width: number): Row[] {
  if (stage === 'harnesses') return harnessRows(form, width);
  if (stage === 'package') return packageRows(form, width);
  return itemRows(data, form, width);
}

/** One rendered line: segments keep their own dim, the line never exceeds the frame. */
function Line({ segments }: { segments: Segment[] }): React.ReactElement {
  return (
    <Text>
      {segments.map((segment, index) => (
        <Text key={index} dimColor={segment.dim} bold={segment.bold}>
          {segment.text}
        </Text>
      ))}
    </Text>
  );
}

/**
 * The focused section's rows, laid out and then windowed: only the lines the body height leaves are
 * mounted, the focused row is always among them, and a package taller than the window scrolls.
 */
function SectionRows({
  rows,
  index,
  width,
  height,
}: {
  rows: Row[];
  index: number;
  width: number;
  height: number;
}): React.ReactElement {
  const laid = rows.map((row) => rowLines(row.lead, row.detail, width));
  const view = rowsInView({ index }, laid.map((lines) => lines.length), height);
  const mounted: React.ReactElement[] = [];
  for (let at = view.start; at < view.end; at += 1) {
    for (const [offset, segments] of (laid[at] ?? []).entries()) {
      mounted.push(<Line key={`${at}-${offset}`} segments={segments} />);
    }
  }
  return <>{mounted}</>;
}

function fold(stage: Stage, form: InstallForm): string | undefined {
  const pkg = chosenPackage(form);
  if (stage === 'harnesses') return t.tui.chosenOf(form.harnessIds.length, form.harnesses.length);
  if (stage === 'package') return pkg ? t.tui.packageSummary(pkg.id, pkg.itemIds.length) : undefined;
  return pkg ? t.tui.chosenOf(form.itemIds.length, pkg.itemIds.length) : undefined;
}

export interface InstallSurfaceProps {
  data: Data;
  form: InstallForm;
  width: number;
  /** The lines the body may use, so the focused section windows instead of overflowing the frame. */
  height: number;
}

/**
 * One section of the form at a time: the focused one lists its rows, the others fold to a one-line
 * summary of what was chosen, so the screen always answers where the user is.
 */
export function InstallSurface({ data, form, width, height }: InstallSurfaceProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      {STAGES.map((stage) => {
        const summary = stage === form.stage ? undefined : fold(stage, form);
        return (
          <Box key={stage} flexDirection="column" marginTop={1}>
            <Text bold>{t.tui.sections[stage]}</Text>
            {stage === form.stage ? (
              <SectionRows
                rows={sectionRows(stage, data, form, width)}
                index={form.cursors[stage]}
                width={width}
                height={Math.max(1, height - INSTALL_CHROME)}
              />
            ) : summary === undefined ? null : (
              <Line segments={[{ text: t.tui.marks.blank }, { text: summary, dim: true }]} />
            )}
          </Box>
        );
      })}
    </Box>
  );
}

import React from 'react';
import { Box, Text } from 'ink';
import { t } from '../i18n.js';
import type { Data, ItemDef } from '../types.js';
import { fitSegments, pad, type Segment } from './format.js';
import { STAGES, chosenPackage, type InstallForm, type PackageRow, type Stage } from './install.js';

/** Below this many columns a row's detail moves to its own indented line instead of its right end. */
export const NARROW_WIDTH = 60;

const MARK = '> ';
const BLANK = '  ';
const SEPARATOR = t.tui.detailSeparator;
/** The parts of an item row that say which of two items of the same kind this one is. */
function itemDetail(item: ItemDef): string[] {
  const parts: string[] = [];
  if (item.kind === 'skill' && item.source) parts.push(`${t.tui.sourcePrefix} ${item.source}`);
  if (item.kind === 'mcp') {
    if (item.url) parts.push(`${t.tui.urlPrefix} ${item.url}`);
    else if (item.package) parts.push(`${t.tui.packagePrefix} ${item.package}`);
  }
  if (item.kind === 'hook' && item.event) parts.push([item.event, item.matcher].filter(Boolean).join(' · '));
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
  return chosen ? '[x] ' : '[ ] ';
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

function HarnessRows({ form, width }: { form: InstallForm; width: number }): React.ReactElement {
  const labelWidth = Math.max(0, ...form.harnesses.map((row) => row.label.length));
  return (
    <>
      {form.harnesses.map((row, index) => {
        const focused = index === form.cursors.harnesses;
        const lead: Segment[] = [
          { text: focused ? MARK : BLANK },
          { text: box(form.harnessIds.includes(row.id)) },
          { text: width < NARROW_WIDTH ? row.label : pad(row.label, labelWidth) },
        ];
        const detail = row.present ? [] : [t.tui.notDetected];
        return rowLines(lead, detail, width).map((segments, row_) => (
          <Line key={`${row.id}-${row_}`} segments={segments} />
        ));
      })}
    </>
  );
}

function PackageRows({ form, width }: { form: InstallForm; width: number }): React.ReactElement {
  const idWidth = Math.max(0, ...form.packages.map((row) => row.id.length)) + 3;
  return (
    <>
      {form.packages.map((row, index) => {
        const focused = index === form.cursors.package;
        const lead: Segment[] = [
          { text: focused ? MARK : BLANK },
          { text: box(row.id === form.packageId) },
          { text: width < NARROW_WIDTH ? row.id : pad(row.id, idWidth) },
        ];
        return rowLines(lead, packageDetail(row), width).map((segments, row_) => (
          <Line key={`${row.id}-${row_}`} segments={segments} />
        ));
      })}
    </>
  );
}

function ItemRows({ data, form, width }: { data: Data; form: InstallForm; width: number }): React.ReactElement {
  const pkg = chosenPackage(form);
  const items = (pkg?.itemIds ?? [])
    .map((id) => data.items.get(id))
    .filter((item): item is ItemDef => item !== undefined);
  const idWidth = Math.max(0, ...items.map((item) => item.id.length)) + 3;
  const kindWidth = Math.max(0, ...items.map((item) => item.kind.length));
  return (
    <>
      {items.map((item, index) => {
        const focused = index === form.cursors.items;
        const mark = { text: focused ? MARK : BLANK };
        const check = { text: box(form.itemIds.includes(item.id)) };
        const lead: Segment[] =
          width < NARROW_WIDTH
            ? [mark, check, { text: `${item.id}  ${item.kind}` }]
            : [mark, check, { text: pad(item.id, idWidth) }, { text: pad(item.kind, kindWidth), dim: true }];
        const detail = itemDetail(item);
        return rowLines(lead, detail, width).map((segments, item_) => (
          <Line key={`${item.id}-${item_}`} segments={segments} />
        ));
      })}
    </>
  );
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
}

/**
 * One section of the form at a time: the focused one lists its rows, the others fold to a one-line
 * summary of what was chosen, so the screen always answers where the user is.
 */
export function InstallSurface({ data, form, width }: InstallSurfaceProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      {STAGES.map((stage) => {
        const summary = stage === form.stage ? undefined : fold(stage, form);
        return (
          <Box key={stage} flexDirection="column" marginTop={1}>
            <Text bold>{t.tui.sections[stage]}</Text>
            {stage === form.stage ? (
              stage === 'harnesses' ? (
                <HarnessRows form={form} width={width} />
              ) : stage === 'package' ? (
                <PackageRows form={form} width={width} />
              ) : (
                <ItemRows data={data} form={form} width={width} />
              )
            ) : summary === undefined ? null : (
              <Line segments={[{ text: BLANK }, { text: summary, dim: true }]} />
            )}
          </Box>
        );
      })}
    </Box>
  );
}

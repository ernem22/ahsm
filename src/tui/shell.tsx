import React, { useState } from 'react';
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import type { Ctx } from '../context.js';
import { t } from '../i18n.js';
import { toneColor, toneDim, type Tone } from '../render.js';
import type { Data } from '../types.js';
import { truncate, wrap } from './format.js';
import { HelpOverlay } from './help.js';
import {
  activeKeys,
  filterOf,
  findBinding,
  frameKeys,
  helpKeys,
  keybarKeys,
  keybarText,
  railText,
  tokenOf,
  type ChromeHost,
  type SurfaceHosts,
  type SurfaceId,
} from './keys.js';
import { planSelection } from './plan.js';
import { SurfaceBody, type SurfaceStates } from './surfaces.js';
import { useApplySurface } from './use-apply.js';
import { useInstallSurface } from './use-install.js';
import { useListSurface } from './use-list.js';
import { usePlanSurface } from './use-plan.js';
import { useRemoveSurface } from './use-remove.js';
import { useStaleSurface } from './use-stale.js';
import { useStatusSurface } from './use-status.js';
import { useUpdateSurface } from './use-update.js';

/** The rail needs 100 columns; below it the letters still work, so width never changes what is reachable. */
export const RAIL_MIN_WIDTH = 100;

/** One line of the status strip: what happened, in the tone that says how much it matters. */
export interface StatusLine {
  text: string;
  tone: Tone;
}

/** The status line wraps like any other text, so a long refusal cannot push the keybar off the frame. */
export function statusLines(status: StatusLine | undefined, width: number): string[] {
  return status === undefined ? [] : wrap(status.text, width);
}

/** Header (two lines), the status strip when there is one, and the keybar: what the body may use. */
export function bodyHeight(rows: number, status: StatusLine | undefined, width: number): number {
  return Math.max(1, rows - 3 - statusLines(status, width).length);
}

export interface ShellProps {
  data: Data;
  ctx: Ctx;
}

/**
 * The window: a header naming the surface and the target, a body, a status line, the keybar last. The
 * shell owns the chrome and which surface is current; every surface's state, cursors, filters and reads
 * live in that surface's own hook, and its key table is handed only its own host.
 */
export function Shell({ data, ctx }: ShellProps): React.ReactElement {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const [surface, setSurface] = useState<SurfaceId>('install');
  const [help, setHelp] = useState(false);
  const [status, setStatus] = useState<StatusLine | undefined>();

  const say = (message: string | undefined, tone: Tone = 'dim'): void => {
    setStatus(message === undefined ? undefined : { text: message, tone });
  };

  const height = bodyHeight(rows, status, columns);
  const install = useInstallSurface(data, ctx);
  const plan = usePlanSurface({
    data,
    ctx,
    selection: planSelection(install.form),
    width: columns,
    height,
    active: surface === 'plan',
  });
  const apply = useApplySurface({ data, ctx, plan: plan.value, updates: plan.updates, say });
  const statusSurface = useStatusSurface({ data, ctx, width: columns, height, active: surface === 'status' });
  const list = useListSurface({ data, ctx, harnessIds: install.form.harnessIds, width: columns, height, active: surface === 'list' });
  const stale = useStaleSurface({ data, ctx, width: columns, height, active: surface === 'stale' });
  const update = useUpdateSurface({ data, ctx, width: columns, height, active: surface === 'update', say });
  const remove = useRemoveSurface({ data, ctx, width: columns, height, active: surface === 'remove', say });
  // The update plan declines back to the surface it was opened from; the shell is the only place that knows.
  const [updateOrigin, setUpdateOrigin] = useState<SurfaceId>('install');

  /**
   * Entering the confirm starts its write state from nothing: a result belongs to the plan it came
   * from, and showing it as the next plan's answer would make the second apply impossible.
   */
  const go = (next: SurfaceId): void => {
    if (next === 'apply') apply.reset();
    if (next === 'update' && surface !== 'update') {
      update.reset();
      setUpdateOrigin(surface);
    }
    if (next === 'remove' && surface !== 'remove') remove.reset();
    setSurface(next);
  };

  const chrome: ChromeHost = {
    surface,
    applying: apply.applying || update.keys.applying || remove.keys.applying,
    result: apply.result,
    go,
    openHelp: () => setHelp(true),
    closeHelp: () => setHelp(false),
    quit: () => exit(),
    say,
  };

  /** A rebuilt plan has no result behind it, so the write state starts over with it. */
  const rebuild = (): void => {
    plan.keys.rebuild();
    apply.reset();
  };

  const hosts: SurfaceHosts = {
    install: { ...chrome, ...install.keys },
    plan: { ...chrome, ...plan.keys, rebuild },
    apply: { ...chrome, ...plan.keys, rebuild, runApply: apply.runApply },
    status: { ...chrome, ...statusSurface.keys },
    list: { ...chrome, ...list.keys },
    stale: { ...chrome, ...stale.keys },
    update: { ...chrome, ...update.keys, decline: () => go(updateOrigin), staleAgain: () => go('stale') },
    remove: { ...chrome, ...remove.keys, decline: () => go('install') },
  };

  const states: SurfaceStates = {
    install,
    plan,
    apply,
    status: statusSurface,
    list,
    stale,
    update,
    remove,
  };

  useInput((input, key) => {
    const token = tokenOf(input, key);
    const binding = findBinding(activeKeys(hosts, chrome, help), token);
    if (!binding) {
      // The filter is a text mode: anything the table did not claim is a character it collects.
      const filter = filterOf(surface, hosts);
      if (!filter?.typing) return;
      if (token === 'backspace') filter.edit((text) => text.slice(0, -1));
      else if (input.length === 1 && !key.ctrl && !key.meta) filter.edit((text) => text + input);
      return;
    }
    const refusal = binding.refuses?.();
    if (refusal !== undefined) {
      say(refusal, 'warning');
      return;
    }
    binding.run();
  });

  // The target is what the user chose, not what detection found: a not detected harness is a choice.
  const labels = install.form.harnesses.filter((row) => install.form.harnessIds.includes(row.id)).map((row) => row.label);
  const target = labels.length > 0 ? labels.join(', ') : t.noHarness;

  const surfaceLabel = t.tui.surfaces[surface];
  const rail = railText(columns, RAIL_MIN_WIDTH);
  // One key set for the frame: the overlay prints all of it, the keybar the entries it does not hide.
  // While the overlay is open the live keys are the overlay's own, so the keybar never lists a dead key.
  const live = frameKeys(hosts, chrome, false);
  const keys = help ? frameKeys(hosts, chrome, true) : live;
  const listed = keybarKeys(help ? helpKeys(chrome) : live);

  return (
    <Box flexDirection="column" height={rows}>
      <Box justifyContent="space-between">
        <Text bold>{truncate(`${t.title}  ${surfaceLabel}`, columns)}</Text>
        {rail ? <Text dimColor>{rail}</Text> : null}
      </Box>
      <Text dimColor>{truncate(`${t.target}: ${target}`, columns)}</Text>
      <Box flexDirection="column" flexGrow={1}>
        {help ? (
          <HelpOverlay title={t.tui.helpTitle(surfaceLabel)} keys={keys} width={columns} />
        ) : (
          <SurfaceBody surface={surface} data={data} states={states} width={columns} height={height} />
        )}
      </Box>
      {status
        ? statusLines(status, columns).map((line, at) => (
            <Text key={at} color={toneColor(status.tone)} dimColor={toneDim(status.tone)}>
              {line}
            </Text>
          ))
        : null}
      <Text dimColor>{keybarText(listed, columns)}</Text>
    </Box>
  );
}

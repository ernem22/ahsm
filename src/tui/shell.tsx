import React, { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import { buildPlan } from '../core/plan.js';
import type { Ctx } from '../context.js';
import { t } from '../i18n.js';
import type { Data } from '../types.js';
import { HelpOverlay } from './help.js';
import { initialForm } from './install.js';
import {
  activeKeys,
  findBinding,
  frameKeys,
  helpKeys,
  keybarKeys,
  keybarText,
  railText,
  tokenOf,
  type KeyHost,
  type SurfaceId,
} from './keys.js';
import { planPage } from './plan-body.js';
import { planSelection } from './plan.js';
import { useRead } from './read.js';
import { SurfaceBody } from './surfaces.js';
import { emptyWindow } from './window.js';

/** The rail needs 100 columns; below it the letters still work, so width never changes what is reachable. */
export const RAIL_MIN_WIDTH = 100;

/** Header (two lines), status line when there is one, and the keybar: what the body may use. */
export function bodyHeight(rows: number, status: string | undefined): number {
  return Math.max(1, rows - 3 - (status === undefined ? 0 : 1));
}

export interface ShellProps {
  data: Data;
  ctx: Ctx;
}

/** The window: a header naming the surface and the target, a body, a status line, the keybar last. */
export function Shell({ data, ctx }: ShellProps): React.ReactElement {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const [surface, setSurface] = useState<SurfaceId>('install');
  const [help, setHelp] = useState(false);
  const [status, setStatus] = useState<string | undefined>();
  // The form lives here, not in the install component: leaving the surface keeps every choice.
  const [install, setInstall] = useState(() => initialForm(data, ctx));
  const [planWindow, setPlanWindow] = useState(emptyWindow);
  // The plan asks the core the same question `agentenv plan` does, for the selection on screen.
  const plan = useRead(() => buildPlan(data, ctx, planSelection(install)));

  // Entering the plan reads it; `r` is the same call, so a second look costs one key.
  useEffect(() => {
    if (surface === 'plan') plan.load();
  }, [surface, plan.load]);

  const host: KeyHost = {
    surface,
    help,
    install,
    plan: planWindow,
    planCount: plan.state.value?.entries.length ?? 0,
    page: planPage(plan.state.value, columns, bodyHeight(rows, status), planWindow),
    go: setSurface,
    openHelp: () => setHelp(true),
    closeHelp: () => setHelp(false),
    quit: () => exit(),
    say: setStatus,
    setInstall,
    setPlanWindow,
    rebuildPlan: plan.load,
  };

  useInput((input, key) => {
    findBinding(activeKeys(surface, help), host, tokenOf(input, key))?.run(host);
  });

  // The target is what the user chose, not what detection found: a not detected harness is a choice.
  const labels = install.harnesses.filter((row) => install.harnessIds.includes(row.id)).map((row) => row.label);
  const target = labels.length > 0 ? labels.join(', ') : t.noHarness;

  const surfaceLabel = t.tui.surfaces[surface];
  const rail = railText(columns, RAIL_MIN_WIDTH);
  // One key set for the frame: the overlay prints all of it, the keybar the entries it does not hide.
  // While the overlay is open the live keys are the overlay's own, so the keybar never lists a dead key.
  const live = frameKeys(surface, false, host);
  const keys = help ? frameKeys(surface, true, host) : live;
  const listed = keybarKeys(help ? [...helpKeys] : live);

  return (
    <Box flexDirection="column" height={rows}>
      <Box justifyContent="space-between">
        <Text bold>{`${t.title}  ${surfaceLabel}`}</Text>
        {rail ? <Text dimColor>{rail}</Text> : null}
      </Box>
      <Text dimColor>{`${t.target}: ${target}`}</Text>
      <Box flexDirection="column" flexGrow={1}>
        {help ? (
          <HelpOverlay title={t.tui.helpTitle(surfaceLabel)} keys={keys} />
        ) : (
          <SurfaceBody
            surface={surface}
            data={data}
            install={install}
            width={columns}
            height={bodyHeight(rows, status)}
            plan={plan.state}
            planWindow={planWindow}
          />
        )}
      </Box>
      {status ? <Text dimColor>{status}</Text> : null}
      <Text dimColor>{keybarText(listed, columns)}</Text>
    </Box>
  );
}

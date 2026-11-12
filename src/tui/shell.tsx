import React, { useState } from 'react';
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
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
import { SurfaceBody } from './surfaces.js';

/** The rail needs 100 columns; below it the letters still work, so width never changes what is reachable. */
export const RAIL_MIN_WIDTH = 100;

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

  const host: KeyHost = {
    surface,
    help,
    install,
    go: setSurface,
    openHelp: () => setHelp(true),
    closeHelp: () => setHelp(false),
    quit: () => exit(),
    say: setStatus,
    setInstall,
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
          <SurfaceBody surface={surface} data={data} install={install} width={columns} />
        )}
      </Box>
      {status ? <Text dimColor>{status}</Text> : null}
      <Text dimColor>{keybarText(listed, columns)}</Text>
    </Box>
  );
}

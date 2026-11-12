import React, { useMemo, useState } from 'react';
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import type { Ctx } from '../context.js';
import { detectHarnesses } from '../core/detect.js';
import { t } from '../i18n.js';
import type { Data } from '../types.js';
import { HelpOverlay } from './help.js';
import {
  activeKeys,
  findBinding,
  frameKeys,
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

  const host: KeyHost = {
    surface,
    help,
    go: setSurface,
    openHelp: () => setHelp(true),
    closeHelp: () => setHelp(false),
    quit: () => exit(),
    say: setStatus,
  };

  useInput((input, key) => {
    findBinding(activeKeys(surface, help), host, tokenOf(input, key))?.run(host);
  });

  const target = useMemo(() => {
    const present = detectHarnesses(data, ctx)
      .filter((harness) => harness.present)
      .map((harness) => harness.def.label ?? harness.def.id);
    return present.length > 0 ? present.join(', ') : t.noHarness;
  }, [data, ctx]);

  const surfaceLabel = t.tui.surfaces[surface];
  const rail = railText(columns, RAIL_MIN_WIDTH);
  // One key set for the frame: the overlay prints all of it, the keybar the entries it does not hide.
  const keys = frameKeys(surface, help, host);
  const listed = keybarKeys(keys);

  return (
    <Box flexDirection="column" height={rows}>
      <Box justifyContent="space-between">
        <Text bold>{`${t.title}  ${surfaceLabel}`}</Text>
        {rail ? <Text dimColor>{rail}</Text> : null}
      </Box>
      <Text dimColor>{`${t.target}: ${target}`}</Text>
      <Box flexDirection="column" flexGrow={1}>
        {help ? <HelpOverlay title={t.tui.helpTitle(surfaceLabel)} keys={keys} /> : <SurfaceBody surface={surface} />}
      </Box>
      {status ? <Text dimColor>{status}</Text> : null}
      <Text dimColor>{keybarText(listed, columns)}</Text>
    </Box>
  );
}

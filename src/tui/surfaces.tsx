import React from 'react';
import { Text } from 'ink';
import { t } from '../i18n.js';
import type { SurfaceId } from './keys.js';

/** A surface whose window is not built yet prints its own name, so every key of the rail moves somewhere. */
export function SurfaceBody({ surface }: { surface: SurfaceId }): React.ReactElement | null {
  if (surface === 'install') return null;
  return <Text>{t.tui.surfaces[surface]}</Text>;
}

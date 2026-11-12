import React from 'react';
import { Text } from 'ink';
import type { Data } from '../types.js';
import { t } from '../i18n.js';
import { InstallSurface } from './install-surface.js';
import type { InstallForm } from './install.js';
import type { SurfaceId } from './keys.js';

export interface SurfaceBodyProps {
  surface: SurfaceId;
  data: Data;
  install: InstallForm;
  width: number;
}

/** One component per surface; the ones whose window is not built yet print their own name. */
export function SurfaceBody({ surface, data, install, width }: SurfaceBodyProps): React.ReactElement | null {
  if (surface === 'install') return <InstallSurface data={data} form={install} width={width} />;
  return <Text>{t.tui.surfaces[surface]}</Text>;
}

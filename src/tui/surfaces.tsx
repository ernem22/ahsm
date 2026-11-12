import React from 'react';
import { Text } from 'ink';
import type { Plan } from '../core/plan.js';
import type { Data } from '../types.js';
import { t } from '../i18n.js';
import { InstallSurface } from './install-surface.js';
import type { InstallForm } from './install.js';
import type { SurfaceId } from './keys.js';
import { PlanSurface } from './plan-body.js';
import type { ReadState } from './read.js';
import type { RowWindow } from './window.js';

export interface SurfaceBodyProps {
  surface: SurfaceId;
  data: Data;
  install: InstallForm;
  width: number;
  /** The lines the body may use, so a body can pin its last line above the keybar. */
  height: number;
  plan: ReadState<Plan>;
  planWindow: RowWindow;
}

/** One component per surface; the ones whose window is not built yet print their own name. */
export function SurfaceBody({
  surface,
  data,
  install,
  width,
  height,
  plan,
  planWindow,
}: SurfaceBodyProps): React.ReactElement | null {
  if (surface === 'install') return <InstallSurface data={data} form={install} width={width} />;
  if (surface === 'plan') return <PlanSurface read={plan} width={width} height={height} window={planWindow} />;
  return <Text>{t.tui.surfaces[surface]}</Text>;
}

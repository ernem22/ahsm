import React from 'react';
import { render } from 'ink';
import type { Ctx } from '../context.js';
import type { Data } from '../types.js';
import { Shell, type ShellProps } from './shell.js';

export function App(props: ShellProps): React.ReactElement {
  return <Shell {...props} />;
}

export async function renderApp(data: Data, ctx: Ctx): Promise<void> {
  const instance = render(<App data={data} ctx={ctx} />);
  await instance.waitUntilExit();
}

import { useState } from 'react';
import type { Ctx } from '../context.js';
import type { Data } from '../types.js';
import { initialForm, type InstallForm } from './install.js';
import type { InstallKeys } from './keys.js';

/** The form and the one handler its table needs: the section it is on and what the user chose. */
export interface InstallState {
  form: InstallForm;
  keys: InstallKeys;
}

/**
 * The install form's state, which lives as long as the window does: leaving the surface for another one
 * and coming back keeps every choice the user has made.
 */
export function useInstallSurface(data: Data, ctx: Ctx): InstallState {
  const [form, setForm] = useState(() => initialForm(data, ctx));
  return { form, keys: { form, set: setForm } };
}

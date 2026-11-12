import React from 'react';
import { Box, Text } from 'ink';
import { entryText, type KeyBinding } from './keys.js';

/** Every key of the surface it was opened on, in the keybar's own words. */
export function HelpOverlay({ title, keys }: { title: string; keys: KeyBinding[] }): React.ReactElement {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>{title}</Text>
      {keys.map((binding) => (
        <Text key={binding.keys.join('+')}>{entryText(binding)}</Text>
      ))}
    </Box>
  );
}

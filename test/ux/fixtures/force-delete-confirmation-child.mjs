import { ForceDeleteConfirmationPrompt } from '../../../lib/ux/forceDeleteConfirmation.js';
import { emitKeypressEvents } from 'node:readline';

// Node installs one shared keypress decoder on first use; it is not a prompt listener.
// Establish that standard decoder before measuring prompt-owned listener cleanup.
emitKeypressEvents(process.stdin);
const bootstrapKeypress = () => undefined;
process.stdin.on('keypress', bootstrapKeypress);
process.stdin.removeListener('keypress', bootstrapKeypress);
process.stdin.pause();
const before = process.stdin.listenerCount('data');
const keypressBefore = process.stdin.listenerCount('keypress');
const rawBefore = process.stdin.isRaw;
const confirmed = await new ForceDeleteConfirmationPrompt().confirm({
  flowApiName: 'Fixture_Flow',
  versionNumber: 12,
  flowNameMessage: 'TYPE_FLOW_API_NAME:',
  versionMessage: 'TYPE_VERSION_NUMBER:',
  output: process.argv[3] === 'stderr' ? process.stderr : process.stdout,
  ms: Number(process.argv[2]),
});
process.stdout.write(
  `FORCE_CONFIRMATION_RESULT:${JSON.stringify({
    confirmed,
    mutations: confirmed ? 1 : 0,
    inputPaused: process.stdin.isPaused(),
    inputIsTTY: process.stdin.isTTY,
    outputIsTTY: process.stdout.isTTY,
    dataListenerDelta: process.stdin.listenerCount('data') - before,
    keypressListenerDelta: process.stdin.listenerCount('keypress') - keypressBefore,
    rawModeRestored: process.stdin.isRaw === rawBefore,
  })}\n`
);

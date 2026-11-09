import { ForceDeleteConfirmationPrompt } from '../../../lib/ux/forceDeleteConfirmation.js';
import { ConfirmationTimeoutError } from '../../../lib/ux/confirmationTimeout.js';
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
let confirmed = false;
let timedOut = false;
try {
  confirmed = await new ForceDeleteConfirmationPrompt().confirm({
    flowApiName: 'Fixture_Flow',
    versionNumber: 12,
    flowNameMessage: 'TYPE_FLOW_API_NAME:',
    versionMessage: 'TYPE_VERSION_NUMBER:',
    output: process.argv[3] === 'stderr' ? process.stderr : process.stdout,
    ms: Number(process.argv[2]),
  });
} catch (error) {
  if (!(error instanceof ConfirmationTimeoutError)) throw error;
  timedOut = true;
}
process.exitCode = timedOut ? 69 : confirmed ? 0 : 1;
process.stdout.write(
  `FORCE_CONFIRMATION_RESULT:${JSON.stringify({
    confirmed,
    timedOut,
    mutations: confirmed ? 1 : 0,
    inputPaused: process.stdin.isPaused(),
    inputIsTTY: process.stdin.isTTY,
    outputIsTTY: process.stdout.isTTY,
    dataListenerDelta: process.stdin.listenerCount('data') - before,
    keypressListenerDelta: process.stdin.listenerCount('keypress') - keypressBefore,
    rawModeRestored: process.stdin.isRaw === rawBefore,
  })}\n`
);

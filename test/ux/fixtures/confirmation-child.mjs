import { ConfirmationPrompt } from '../../../lib/ux/confirmation.js';
import { ConfirmationTimeoutError } from '../../../lib/ux/confirmationTimeout.js';

let mutations = 0;
let confirmed = false;
let timedOut = false;
try {
  confirmed = await new ConfirmationPrompt().confirm({
    message: 'Confirm the test mutation?',
    ms: Number(process.argv[2]),
  });
} catch (error) {
  if (!(error instanceof ConfirmationTimeoutError)) throw error;
  timedOut = true;
}
if (confirmed) mutations += 1;
process.exitCode = timedOut ? 69 : confirmed ? 0 : 1;
process.stdout.write(
  `CONFIRMATION_RESULT:${JSON.stringify({ confirmed, timedOut, mutations, inputPaused: process.stdin.isPaused() })}\n`
);

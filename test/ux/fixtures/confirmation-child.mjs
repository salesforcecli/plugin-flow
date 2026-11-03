import { ConfirmationPrompt } from '../../../lib/ux/confirmation.js';

let mutations = 0;
const confirmed = await new ConfirmationPrompt().confirm({
  message: 'Confirm the test mutation?',
  ms: Number(process.argv[2]),
});
if (confirmed) mutations += 1;
process.stdout.write(
  `CONFIRMATION_RESULT:${JSON.stringify({ confirmed, mutations, inputPaused: process.stdin.isPaused() })}\n`
);

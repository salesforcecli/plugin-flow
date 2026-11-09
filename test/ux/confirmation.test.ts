/*
 * Copyright 2026, Salesforce, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect } from 'chai';
import sinon from 'sinon';
import type inquirerConfirm from '@inquirer/confirm';
import { ConfirmationTimeoutError } from '../../src/ux/confirmationTimeout.js';
import { ConfirmationPrompt } from '../../src/ux/confirmation.js';

type PromptFunction = typeof inquirerConfirm;
type ChildResult = {
  confirmed: boolean;
  timedOut: boolean;
  exitCode: number;
  mutations: number;
  inputPaused: boolean;
};

async function runRealPrompt(answer?: string): Promise<ChildResult> {
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL('./fixtures/confirmation-child.mjs', import.meta.url)),
      answer === undefined ? '50' : '2000',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  );
  let output = '';
  let stderr = '';
  let answered = false;
  let inputEnded = false;
  return new Promise((resolve, reject) => {
    const watchdog = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`The confirmation child did not exit naturally. Output: ${output}\n${stderr}`));
    }, 5000);
    child.once('error', (error) => {
      clearTimeout(watchdog);
      reject(error);
    });
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (answer !== undefined && !answered && output.includes('(y/N)')) {
        answered = true;
        child.stdin.write(answer);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once('exit', () => {
      inputEnded = child.stdin.writableEnded;
    });
    child.once('close', (code, signal) => {
      clearTimeout(watchdog);
      try {
        expect(signal, stderr).to.equal(null);
        expect(inputEnded, 'the parent must keep stdin open until the child exits').to.equal(false);
        const serialized = /CONFIRMATION_RESULT:(\{[^\n]+\})/.exec(output)?.[1];
        if (!serialized) throw new Error(`Missing confirmation result: ${output}`);
        const result = JSON.parse(serialized) as Omit<ChildResult, 'exitCode'>;
        expect(code, stderr).to.equal(result.timedOut ? 69 : result.confirmed ? 0 : 1);
        resolve({ ...result, exitCode: code! });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

describe('ConfirmationPrompt', () => {
  const sandbox = sinon.createSandbox();
  let prompt: sinon.SinonStub<Parameters<PromptFunction>, ReturnType<PromptFunction>>;

  beforeEach(() => {
    prompt = sandbox.stub<Parameters<PromptFunction>, ReturnType<PromptFunction>>().resolves(false);
  });

  afterEach(() => sandbox.restore());

  it('uses the standard confirm prompt with a false default and a 60-second deadline', async () => {
    const clock = sandbox.useFakeTimers();
    const result = await new ConfirmationPrompt(prompt).confirm({ message: 'Delete the selected versions?' });

    expect(result).to.equal(false);
    expect(prompt.calledOnce).to.equal(true);
    expect(prompt.firstCall.args[0]).to.deep.equal({ message: 'Delete the selected versions?', default: false });
    expect(prompt.firstCall.args[1]?.signal).to.be.instanceOf(AbortSignal);
    expect(clock.countTimers()).to.equal(0);
  });

  it('returns explicit confirmation and clears the deadline on success', async () => {
    const clock = sandbox.useFakeTimers();
    prompt.resolves(true);

    expect(await new ConfirmationPrompt(prompt).confirm({ message: 'Delete?' })).to.equal(true);
    expect(clock.countTimers()).to.equal(0);
  });

  it('aborts the underlying prompt after exactly the default 60-second deadline', async () => {
    const clock = sandbox.useFakeTimers();
    const expected = new Error('deadline');
    expected.name = 'AbortPromptError';
    prompt.callsFake(
      (_config, context) =>
        new Promise((_resolve, reject) => {
          context?.signal?.addEventListener('abort', () => reject(expected));
        })
    );
    const confirmation = new ConfirmationPrompt(prompt)
      .confirm({ message: 'Delete?' })
      .catch((error: unknown) => error);
    const signal = prompt.firstCall.args[1]?.signal;

    await clock.tickAsync(59_999);
    expect(signal?.aborted).to.equal(false);
    await clock.tickAsync(1);
    expect(await confirmation).to.be.instanceOf(ConfirmationTimeoutError);
    expect(signal?.aborted).to.equal(true);
    expect(clock.countTimers()).to.equal(0);
  });

  it('rejects a late yes from a prompt that ignores its abort signal', async () => {
    const clock = sandbox.useFakeTimers();
    prompt.callsFake(async () => {
      await new Promise((resolve) => setTimeout(resolve, 51));
      return true;
    });
    const confirmation = new ConfirmationPrompt(prompt)
      .confirm({ message: 'Delete?', ms: 50 })
      .catch((error: unknown) => error);
    await clock.tickAsync(51);
    expect(await confirmation).to.be.instanceOf(ConfirmationTimeoutError);
    expect(clock.countTimers()).to.equal(0);
  });

  it('returns false when the user cancels and clears the deadline', async () => {
    const clock = sandbox.useFakeTimers();
    const error = new Error('User force closed the prompt with SIGINT');
    error.name = 'ExitPromptError';
    prompt.rejects(error);

    expect(await new ConfirmationPrompt(prompt).confirm({ message: 'Delete?' })).to.equal(false);
    expect(clock.countTimers()).to.equal(0);
  });

  it('propagates prompt failures and clears the deadline', async () => {
    const clock = sandbox.useFakeTimers();
    const error = new Error('Unexpected prompt failure');
    prompt.rejects(error);
    let caught: unknown;
    try {
      await new ConfirmationPrompt(prompt).confirm({ message: 'Delete?' });
    } catch (failure) {
      caught = failure;
    }

    expect(caught).to.equal(error);
    expect(clock.countTimers()).to.equal(0);
  });

  it('does not swallow an abort error before its own deadline', async () => {
    const error = new Error('An unrelated prompt abort');
    error.name = 'AbortPromptError';
    prompt.rejects(error);
    let caught: unknown;
    try {
      await new ConfirmationPrompt(prompt).confirm({ message: 'Delete?', ms: 1000 });
    } catch (failure) {
      caught = failure;
    }

    expect(caught).to.equal(error);
  });

  it('rejects a true default before opening a prompt', async () => {
    let caught: unknown;
    try {
      await new ConfirmationPrompt(prompt).confirm({ message: 'Delete?', defaultAnswer: true });
    } catch (failure) {
      caught = failure;
    }

    expect(caught).to.be.instanceOf(TypeError);
    expect(prompt.called).to.equal(false);
  });

  it('cleans up a real timed-out prompt and exits naturally with stdin still open', async () => {
    expect(await runRealPrompt()).to.deep.equal({
      confirmed: false,
      timedOut: true,
      exitCode: 69,
      mutations: 0,
      inputPaused: true,
    });
  });

  it('accepts yes through the real prompt and exits naturally', async () => {
    expect(await runRealPrompt('y\n')).to.deep.equal({
      confirmed: true,
      timedOut: false,
      exitCode: 0,
      mutations: 1,
      inputPaused: true,
    });
  });

  it('accepts no through the real prompt without a mutation', async () => {
    expect(await runRealPrompt('n\n')).to.deep.equal({
      confirmed: false,
      timedOut: false,
      exitCode: 1,
      mutations: 0,
      inputPaused: true,
    });
  });

  it('defaults to no on Enter through the real prompt', async () => {
    expect(await runRealPrompt('\n')).to.deep.equal({
      confirmed: false,
      timedOut: false,
      exitCode: 1,
      mutations: 0,
      inputPaused: true,
    });
  });

  it('handles Ctrl-C through the real prompt without a mutation', async () => {
    expect(await runRealPrompt('\u0003')).to.deep.equal({
      confirmed: false,
      timedOut: false,
      exitCode: 1,
      mutations: 0,
      inputPaused: true,
    });
  });
});

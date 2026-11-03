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

import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect } from 'chai';
import sinon from 'sinon';
import {
  ForceDeleteConfirmationPrompt,
  type ForceDeleteConfirmationOptions,
  type ForceDeleteInputPrompt,
} from '../../src/ux/forceDeleteConfirmation.js';

const options = (): ForceDeleteConfirmationOptions => ({
  flowApiName: 'Fixture_Flow',
  versionNumber: 12,
  flowNameMessage: 'Type the Flow API name:',
  versionMessage: 'Type the version number:',
});

type ChildResult = {
  confirmed: boolean;
  mutations: number;
  inputPaused: boolean;
  inputIsTTY: boolean;
  outputIsTTY: boolean;
  dataListenerDelta: number;
  keypressListenerDelta: number;
  rawModeRestored: boolean;
};

async function runRealPrompt(mode: string): Promise<ChildResult> {
  const child = spawn(
    'python3',
    [
      fileURLToPath(new URL('./fixtures/force-delete-confirmation-pty.py', import.meta.url)),
      process.execPath,
      fileURLToPath(new URL('./fixtures/force-delete-confirmation-child.mjs', import.meta.url)),
      mode,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  );
  let output = '';
  let stderr = '';
  return new Promise((resolve, reject) => {
    const watchdog = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`The PTY confirmation child did not exit naturally. Output: ${output}\n${stderr}`));
    }, 6000);
    child.once('error', (error) => {
      clearTimeout(watchdog);
      reject(error);
    });
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once('close', (code, signal) => {
      clearTimeout(watchdog);
      try {
        expect(signal, stderr).to.equal(null);
        expect(code, stderr).to.equal(0);
        expect(child.stdin.writableEnded, 'the parent leaves the PTY runner input open').to.equal(false);
        const serialized = /FORCE_CONFIRMATION_RESULT:(\{[^\r\n]+\})/.exec(output)?.[1];
        if (!serialized) throw new Error(`Missing confirmation result: ${output}`);
        resolve(JSON.parse(serialized) as ChildResult);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

describe('ForceDeleteConfirmationPrompt', () => {
  const sandbox = sinon.createSandbox();
  let prompt: sinon.SinonStub<Parameters<ForceDeleteInputPrompt>, ReturnType<ForceDeleteInputPrompt>>;
  let originalInputTTY: PropertyDescriptor | undefined;
  let originalOutputTTY: PropertyDescriptor | undefined;
  let originalErrorTTY: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalInputTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    originalOutputTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    originalErrorTTY = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: true });
    prompt = sandbox.stub<Parameters<ForceDeleteInputPrompt>, ReturnType<ForceDeleteInputPrompt>>();
    prompt.onFirstCall().resolves('Fixture_Flow');
    prompt.onSecondCall().resolves('12');
  });

  afterEach(() => {
    sandbox.restore();
    if (originalInputTTY) Object.defineProperty(process.stdin, 'isTTY', originalInputTTY);
    else Reflect.deleteProperty(process.stdin, 'isTTY');
    if (originalOutputTTY) Object.defineProperty(process.stdout, 'isTTY', originalOutputTTY);
    else Reflect.deleteProperty(process.stdout, 'isTTY');
    if (originalErrorTTY) Object.defineProperty(process.stderr, 'isTTY', originalErrorTTY);
    else Reflect.deleteProperty(process.stderr, 'isTTY');
  });

  it('requires two exact typed values, with no defaults and one shared two-minute deadline', async () => {
    const clock = sandbox.useFakeTimers();
    expect(await new ForceDeleteConfirmationPrompt(prompt).confirm(options())).to.equal(true);
    expect(prompt.callCount).to.equal(2);
    expect(prompt.firstCall.args[0]).to.deep.equal({ message: 'Type the Flow API name:' });
    expect(prompt.secondCall.args[0]).to.deep.equal({ message: 'Type the version number:' });
    expect(prompt.firstCall.args[1]).to.equal(prompt.secondCall.args[1]);
    expect(prompt.firstCall.args[1].clearPromptOnDone).to.equal(true);
    expect(prompt.firstCall.args[1].output).to.equal(process.stdout);
    expect(prompt.firstCall.args[1].signal).to.be.instanceOf(AbortSignal);
    expect(clock.countTimers()).to.equal(0);
  });

  it('uses an explicitly selected interactive stderr for both questions', async () => {
    expect(await new ForceDeleteConfirmationPrompt(prompt).confirm({ ...options(), output: process.stderr })).to.equal(
      true
    );
    expect(prompt.firstCall.args[1].output).to.equal(process.stderr);
    expect(prompt.secondCall.args[1].output).to.equal(process.stderr);
  });

  it('rejects a selected prompt output that is not a terminal', async () => {
    Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: false });
    let caught: unknown;
    try {
      await new ForceDeleteConfirmationPrompt(prompt).confirm({ ...options(), output: process.stderr });
    } catch (error) {
      caught = error;
    }
    expect(caught).to.be.instanceOf(TypeError);
    expect(prompt.called).to.equal(false);
  });

  it('rejects a different or case-changed Flow name without asking for a version', async () => {
    prompt.onFirstCall().resolves('fixture_Flow');
    expect(await new ForceDeleteConfirmationPrompt(prompt).confirm(options())).to.equal(false);
    expect(prompt.calledOnce).to.equal(true);
  });

  it('does not trim or normalize a typed API name', async () => {
    prompt.onFirstCall().resolves('Fixture_Flow ');
    expect(await new ForceDeleteConfirmationPrompt(prompt).confirm(options())).to.equal(false);
    expect(prompt.calledOnce).to.equal(true);
  });

  it('does not accept a blank Flow name as confirmation', async () => {
    prompt.onFirstCall().resolves('');
    expect(await new ForceDeleteConfirmationPrompt(prompt).confirm(options())).to.equal(false);
  });

  for (const value of ['012', '12 ', ' 12', '13', '']) {
    it(`rejects non-exact version text ${JSON.stringify(value)}`, async () => {
      prompt.onSecondCall().resolves(value);
      expect(await new ForceDeleteConfirmationPrompt(prompt).confirm(options())).to.equal(false);
    });
  }

  it('requires interactive stdin and stdout before starting either prompt', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
    let error: unknown;
    try {
      await new ForceDeleteConfirmationPrompt(prompt).confirm(options());
    } catch (caught) {
      error = caught;
    }
    expect(error).to.be.instanceOf(TypeError);
    expect(prompt.called).to.equal(false);
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });
    error = undefined;
    try {
      await new ForceDeleteConfirmationPrompt(prompt).confirm(options());
    } catch (caught) {
      error = caught;
    }
    expect(error).to.be.instanceOf(TypeError);
    expect(prompt.called).to.equal(false);
  });

  it('does not continue when the terminal context changes after the first prompt', async () => {
    prompt.onFirstCall().callsFake(async () => {
      Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });
      return 'Fixture_Flow';
    });
    let error: unknown;
    try {
      await new ForceDeleteConfirmationPrompt(prompt).confirm(options());
    } catch (caught) {
      error = caught;
    }
    expect(error).to.be.instanceOf(TypeError);
    expect(prompt.calledOnce).to.equal(true);
  });

  it('does not confirm when the terminal context changes after the exact version was entered', async () => {
    prompt.onSecondCall().callsFake(async () => {
      Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });
      return '12';
    });
    let caught: unknown;
    try {
      await new ForceDeleteConfirmationPrompt(prompt).confirm(options());
    } catch (error) {
      caught = error;
    }
    expect(caught).to.be.instanceOf(TypeError);
    expect(prompt.callCount).to.equal(2);
  });

  it('uses a single deadline without resetting it for the second question', async () => {
    const clock = sandbox.useFakeTimers();
    prompt.onFirstCall().callsFake(async () => {
      await new Promise((resolve) => setTimeout(resolve, 90_000));
      return 'Fixture_Flow';
    });
    prompt.onSecondCall().callsFake(
      (_config, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('deadline'), { name: 'AbortPromptError' }))
          );
        })
    );
    const confirmation = new ForceDeleteConfirmationPrompt(prompt).confirm(options());
    await clock.tickAsync(90_000);
    expect(prompt.callCount).to.equal(2);
    await clock.tickAsync(29_999);
    expect(prompt.secondCall.args[1].signal.aborted).to.equal(false);
    await clock.tickAsync(1);
    expect(await confirmation).to.equal(false);
    expect(clock.countTimers()).to.equal(0);
  });

  it('cleans up its deadline when the user cancels', async () => {
    const clock = sandbox.useFakeTimers();
    prompt.onSecondCall().rejects(Object.assign(new Error('cancelled'), { name: 'ExitPromptError' }));
    expect(await new ForceDeleteConfirmationPrompt(prompt).confirm(options())).to.equal(false);
    expect(clock.countTimers()).to.equal(0);
  });

  it('does not swallow an unrelated prompt failure or abort', async () => {
    const clock = sandbox.useFakeTimers();
    const expected = Object.assign(new Error('unrelated failure'), { name: 'AbortPromptError' });
    prompt.onFirstCall().rejects(expected);
    let caught: unknown;
    try {
      await new ForceDeleteConfirmationPrompt(prompt).confirm(options());
    } catch (error) {
      caught = error;
    }
    expect(caught).to.equal(expected);
    expect(clock.countTimers()).to.equal(0);
  });

  for (const invalid of [
    { flowApiName: 'Flow\nInjected' },
    { versionNumber: 0 },
    { versionNumber: 1.2 },
    { flowNameMessage: '' },
    { versionMessage: '' },
    { ms: 0 },
    { ms: Number.NaN },
    { ms: 2_147_483_648 },
  ]) {
    it(`rejects invalid confirmation input ${JSON.stringify(invalid)} before prompting`, async () => {
      let caught: unknown;
      try {
        await new ForceDeleteConfirmationPrompt(prompt).confirm({ ...options(), ...invalid });
      } catch (error) {
        caught = error;
      }
      expect(caught).to.be.instanceOf(TypeError);
      expect(prompt.called).to.equal(false);
    });
  }

  const hasPtyAndPython =
    process.platform !== 'win32' && spawnSync('python3', ['--version'], { stdio: 'ignore' }).status === 0;
  const ptyTest = hasPtyAndPython ? it : it.skip;
  for (const mode of [
    'match',
    'stderr-match',
    'mismatch',
    'version-mismatch',
    'cancel',
    'timeout-flow',
    'timeout-version',
  ]) {
    ptyTest(`releases the real terminal after ${mode} (requires POSIX PTY and Python3)`, async () => {
      expect(await runRealPrompt(mode)).to.deep.equal({
        confirmed: mode === 'match' || mode === 'stderr-match',
        mutations: mode === 'match' || mode === 'stderr-match' ? 1 : 0,
        inputPaused: true,
        inputIsTTY: true,
        outputIsTTY: true,
        dataListenerDelta: 0,
        keypressListenerDelta: 0,
        rawModeRestored: true,
      });
    });
  }
});

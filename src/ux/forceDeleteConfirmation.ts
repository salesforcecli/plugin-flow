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

import inquirerInput from '@inquirer/input';

export type ForceDeleteInputPrompt = (
  config: { message: string },
  context: { signal: AbortSignal; clearPromptOnDone: true; output: NodeJS.WriteStream }
) => Promise<string>;

export type ForceDeleteConfirmationOptions = {
  flowApiName: string;
  versionNumber: number;
  flowNameMessage: string;
  versionMessage: string;
  /** Human prompts can use stderr while the command reserves stdout for JSON. */
  output?: NodeJS.WriteStream;
  /** One shared deadline for both prompts. The caller may bound this by token expiry. */
  ms?: number;
};

const requireInteractiveTerminal = (output: NodeJS.WriteStream): void => {
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true || output.isTTY !== true) {
    throw new TypeError('Force deletion requires interactive stdin, stdout and prompt output.');
  }
};

const validateConfirmationValues = ({
  flowApiName,
  versionNumber,
  flowNameMessage,
  versionMessage,
  ms,
}: Required<Omit<ForceDeleteConfirmationOptions, 'output'>>): void => {
  if (typeof flowApiName !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,254}$/.test(flowApiName))
    throw new TypeError('Confirmation requires a valid Flow API name.');
  if (!Number.isSafeInteger(versionNumber) || versionNumber < 1)
    throw new TypeError('Confirmation requires a positive version number.');
  if (typeof flowNameMessage !== 'string' || typeof versionMessage !== 'string' || !flowNameMessage || !versionMessage)
    throw new TypeError('Both confirmation prompt messages are required.');
  if (!Number.isSafeInteger(ms) || ms <= 0 || ms > 2_147_483_647)
    throw new TypeError('The confirmation deadline must be a positive supported number of milliseconds.');
};

/** Two exact typed values, without a default, persisted answers or non-interactive bypass. */
export class ForceDeleteConfirmationPrompt {
  public constructor(private readonly prompt: ForceDeleteInputPrompt = inquirerInput) {}

  public async confirm({
    flowApiName,
    versionNumber,
    flowNameMessage,
    versionMessage,
    output = process.stdout,
    ms = 120_000,
  }: ForceDeleteConfirmationOptions): Promise<boolean> {
    requireInteractiveTerminal(output);
    validateConfirmationValues({ flowApiName, versionNumber, flowNameMessage, versionMessage, ms });

    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), ms);
    const context = { signal: controller.signal, clearPromptOnDone: true as const, output };
    try {
      const flowName = await this.prompt({ message: flowNameMessage }, context);
      requireInteractiveTerminal(output);
      if (controller.signal.aborted || flowName !== flowApiName) return false;
      const version = await this.prompt({ message: versionMessage }, context);
      requireInteractiveTerminal(output);
      return !controller.signal.aborted && version === String(versionNumber);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'ExitPromptError' || (error.name === 'AbortPromptError' && controller.signal.aborted))
      )
        return false;
      throw error;
    } finally {
      clearTimeout(deadline);
    }
  }
}

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

import inquirerConfirm from '@inquirer/confirm';
import { ConfirmationTimeoutError } from './confirmationTimeout.js';

export type ConfirmationOptions = {
  message: string;
  ms?: number;
  defaultAnswer?: boolean;
};

export class ConfirmationPrompt {
  public constructor(private readonly prompt: typeof inquirerConfirm = inquirerConfirm) {}

  public async confirm({ message, ms = 60_000, defaultAnswer = false }: ConfirmationOptions): Promise<boolean> {
    if (defaultAnswer) throw new TypeError('Confirmation prompts require a false default answer.');
    if (!Number.isSafeInteger(ms) || ms <= 0 || ms > 2_147_483_647)
      throw new TypeError('The confirmation deadline must be a positive supported number of milliseconds.');

    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), ms);
    try {
      const confirmed = await this.prompt({ message, default: false }, { signal: controller.signal });
      if (controller.signal.aborted) throw new ConfirmationTimeoutError();
      return confirmed;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortPromptError' && controller.signal.aborted)
        throw new ConfirmationTimeoutError();
      if (error instanceof Error && error.name === 'ExitPromptError') return false;
      throw error;
    } finally {
      clearTimeout(deadline);
    }
  }
}

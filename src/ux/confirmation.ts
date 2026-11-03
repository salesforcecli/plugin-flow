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

export type ConfirmationOptions = {
  message: string;
  ms?: number;
  defaultAnswer?: boolean;
};

export class ConfirmationPrompt {
  public constructor(private readonly prompt: typeof inquirerConfirm = inquirerConfirm) {}

  public async confirm({ message, ms = 60_000, defaultAnswer = false }: ConfirmationOptions): Promise<boolean> {
    if (defaultAnswer) throw new TypeError('Confirmation prompts require a false default answer.');

    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), ms);
    try {
      return await this.prompt({ message, default: false }, { signal: controller.signal });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'ExitPromptError' || (error.name === 'AbortPromptError' && controller.signal.aborted))
      ) {
        return false;
      }
      throw error;
    } finally {
      clearTimeout(deadline);
    }
  }
}

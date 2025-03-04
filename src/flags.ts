/*
 * Copyright (c) 2023, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Messages } from '@salesforce/core';
import { Flags } from '@salesforce/sf-plugins-core';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-flow', 'flags');

export const TestLevelValues = ['RunLocalTests', 'RunAllTestsInOrg', 'RunSpecifiedTests'];

export const resultFormatFlag = Flags.string({
  deprecateAliases: true,
  aliases: ['resultformat'],
  char: 'r',
  summary: messages.getMessage('flags.result-format.summary'),
  options: ['human', 'tap', 'junit', 'json'] as const,
  default: 'human',
});

export const codeCoverageFlag = Flags.boolean({
  aliases: ['codecoverage'],
  deprecateAliases: true,
  char: 'c',
  summary: messages.getMessage('flags.code-coverage.summary'),
});

export const outputDirectory = Flags.directory({
  aliases: ['outputdir', 'output-directory'],
  deprecateAliases: true,
  char: 'd',
  summary: messages.getMessage('flags.output-dir.summary'),
});

export const concise = Flags.boolean({
  summary: messages.getMessage('flags.concise.summary'),
});

export const synchronous = Flags.boolean({
  char: 'y',
  summary: messages.getMessage('flags.synchronous.summary'),
});

export const testLevelFlag = Flags.string({
  deprecateAliases: true,
  aliases: ['testlevel'],
  char: 'l',
  summary: messages.getMessage('flags.test-level.summary'),
  description: messages.getMessage('flags.test-level.description'),
  options: TestLevelValues,
});


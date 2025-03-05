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
const exclusiveTestSpecifiers = ['class-names', 'suite-names', 'tests'];

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

export const outputDirectoryFlag = Flags.directory({
  aliases: ['outputdir', 'output-directory'],
  deprecateAliases: true,
  char: 'd',
  summary: messages.getMessage('flags.output-dir.summary'),
});

export const conciseFlag = Flags.boolean({
  summary: messages.getMessage('flags.concise.summary'),
});

export const synchronousFlag = Flags.boolean({
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

export const classNamesFlag = Flags.string({
  aliases: ['classnames'],
  char: 'n',
  multiple: true,
  summary: messages.getMessage('flags.class-names.summary'),
  description: messages.getMessage('flags.class-names.description'),
  exclusive: exclusiveTestSpecifiers.filter((specifier) => specifier !== 'class-names'),
});

export const suiteNamesFlag = Flags.string({
  aliases: ['suitenames'],
  char: 's',
  multiple: true,
  summary: messages.getMessage('flags.suite-names.summary'),
  description: messages.getMessage('flags.suite-names.description'),
  exclusive: exclusiveTestSpecifiers.filter((specifier) => specifier !== 'suite-names'),
});

export const testsFlag = Flags.string({
  aliases: ['tests'],
  char: 't',
  multiple: true,
  summary: messages.getMessage('flags.tests.summary'),
  description: messages.getMessage('flags.tests.description'),
  exclusive: exclusiveTestSpecifiers.filter((specifier) => specifier !== 'tests'),
});

export const numberFlag = Flags.integer({
  char: 'n',
  min: 1,
  max: 25,
  summary: messages.getMessage('flags.number.summary'),
});

export const logIdFlag = Flags.salesforceId({
  deprecateAliases: true,
  aliases: ['logid'],
  char: 'i',
  summary: messages.getMessage('flags.log-id.summary'),
  startsWith: '07L',
  length: 'both',
});

export const testRunIdFlag = Flags.salesforceId({
  deprecateAliases: true,
  aliases: ['testrunid'],
  char: 'i',
  summary: messages.getMessage('flags.test-run-id.summary'),
  required: true,
  startsWith: '707',
  length: 'both',
});

export const detailedCoverageSummaryFlag = Flags.boolean({
  summary: messages.getMessage('flags.detailed-coverage.summary'),
  dependsOn: ['code-coverage'],
});



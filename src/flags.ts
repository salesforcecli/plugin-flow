/*
 * Copyright 2025, Salesforce, Inc.
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

import { Messages } from '@salesforce/core';
import { Flags } from '@salesforce/sf-plugins-core';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-flow', 'flags');

export const TestLevelValues = ['RunLocalTests', 'RunAllTestsInOrg', 'RunSpecifiedTests'];
const exclusiveTestSpecifiers = ['class-names', 'suite-names', 'tests'];

export const resultFormatFlag = Flags.string({
  char: 'r',
  summary: messages.getMessage('flags.result-format.summary'),
  options: ['human', 'tap', 'junit', 'json'] as const,
  default: 'human',
});

export const codeCoverageFlag = Flags.boolean({
  char: 'c',
  summary: messages.getMessage('flags.code-coverage.summary'),
});

export const outputDirectoryFlag = Flags.directory({
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
  parse: async (input) => Promise.resolve(`flowtesting.${input}`),
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
  char: 't',
  multiple: true,
  summary: messages.getMessage('flags.tests.summary'),
  description: messages.getMessage('flags.tests.description'),
  parse: async (input) => Promise.resolve(`flowtesting.${input}`),
  exclusive: exclusiveTestSpecifiers.filter((specifier) => specifier !== 'tests'),
});

export const numberFlag = Flags.integer({
  char: 'n',
  min: 1,
  max: 25,
  summary: messages.getMessage('flags.number.summary'),
});

export const logIdFlag = Flags.salesforceId({
  char: 'i',
  summary: messages.getMessage('flags.log-id.summary'),
  startsWith: '07L',
  length: 'both',
});

export const testRunIdFlag = Flags.salesforceId({
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

export const waitFlag = Flags.duration({
  unit: 'minutes',
  char: 'w',
  summary: messages.getMessage('flags.wait.summary'),
  min: 0,
});

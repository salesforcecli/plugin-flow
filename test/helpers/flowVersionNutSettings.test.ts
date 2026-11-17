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

import { expect } from 'chai';
import { flowVersionNutSettings } from './flowVersionNutSettings.js';

const configured = (): Record<string, string> => ({
  FLOW_VERSION_NUT_TARGET_ORG: 'read-only-source',
  FLOW_VERSION_NUT_FLOW: 'namespace__Read_Only_Fixture',
  FLOW_VERSION_NUT_VERSIONS: '1,3',
});

describe('read-only Flow version NUT configuration', () => {
  it('does not opt in without explicit fixture configuration', () => {
    expect(flowVersionNutSettings({})).to.equal(null);
  });
  it('accepts bounded fixture values and the documented minimum API default', () => {
    expect(flowVersionNutSettings(configured())).to.deep.equal({
      targetOrg: 'read-only-source',
      flowApiName: 'namespace__Read_Only_Fixture',
      versions: [1, 3],
      apiVersion: '67.0',
    });
  });
  it('accepts a username and an explicitly selected API version', () => {
    expect(
      flowVersionNutSettings({
        ...configured(),
        FLOW_VERSION_NUT_TARGET_ORG: 'test.user+nut@example.invalid',
        FLOW_VERSION_NUT_API_VERSION: '68.0',
      })
    ).to.include({ targetOrg: 'test.user+nut@example.invalid', apiVersion: '68.0' });
  });
  for (const key of ['FLOW_VERSION_NUT_TARGET_ORG', 'FLOW_VERSION_NUT_FLOW', 'FLOW_VERSION_NUT_VERSIONS']) {
    it(`rejects partial opt-in missing ${key}`, () => {
      const values = configured();
      delete values[key];
      expect(() => flowVersionNutSettings(values)).to.throw('Set FLOW_VERSION_NUT_TARGET_ORG');
    });
  }
  for (const [key, value] of [
    ['FLOW_VERSION_NUT_TARGET_ORG', '--no-prompt'],
    ['FLOW_VERSION_NUT_TARGET_ORG', 'source;false'],
    ['FLOW_VERSION_NUT_TARGET_ORG', '$(false)'],
    ['FLOW_VERSION_NUT_TARGET_ORG', 'source org'],
    ['FLOW_VERSION_NUT_FLOW', 'Flow;false'],
    ['FLOW_VERSION_NUT_FLOW', '--no-prompt'],
    ['FLOW_VERSION_NUT_FLOW', 'Flow`false`'],
    ['FLOW_VERSION_NUT_VERSIONS', '1 --no-prompt'],
    ['FLOW_VERSION_NUT_VERSIONS', '1;false'],
    ['FLOW_VERSION_NUT_VERSIONS', '0'],
    ['FLOW_VERSION_NUT_VERSIONS', '1-2'],
    ['FLOW_VERSION_NUT_VERSIONS', '1,1'],
    ['FLOW_VERSION_NUT_VERSIONS', '9007199254740992'],
    ['FLOW_VERSION_NUT_API_VERSION', '66.0'],
    ['FLOW_VERSION_NUT_API_VERSION', '67.0;false'],
  ]) {
    it(`rejects unsafe or unsupported ${key}: ${JSON.stringify(value)}`, () => {
      expect(() => flowVersionNutSettings({ ...configured(), [key]: value })).to.throw();
    });
  }
  it('bounds the fixture selection before constructing any CLI command', () => {
    expect(() =>
      flowVersionNutSettings({
        ...configured(),
        FLOW_VERSION_NUT_VERSIONS: Array.from({ length: 201 }, (_, index) => index + 1).join(','),
      })
    ).to.throw('1 to 200');
  });
});

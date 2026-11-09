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

export type FlowVersionNutSettings = {
  targetOrg: string;
  flowApiName: string;
  versions: number[];
  apiVersion: string;
};

const requiredKeys = ['FLOW_VERSION_NUT_TARGET_ORG', 'FLOW_VERSION_NUT_FLOW', 'FLOW_VERSION_NUT_VERSIONS'] as const;
const apiKey = 'FLOW_VERSION_NUT_API_VERSION';

/** Opt in explicitly; every returned value is safe as one unquoted testkit shell argument. */
export const flowVersionNutSettings = (
  values: Readonly<Record<string, string | undefined>>
): FlowVersionNutSettings | null => {
  if (![...requiredKeys, apiKey].some((key) => values[key] !== undefined)) return null;
  for (const key of requiredKeys) {
    if (!values[key]) throw new Error(`Set ${requiredKeys.join(', ')} to run the read-only live-org NUTs.`);
  }
  const targetOrg = values.FLOW_VERSION_NUT_TARGET_ORG!;
  const flowApiName = values.FLOW_VERSION_NUT_FLOW!;
  const versionText = values.FLOW_VERSION_NUT_VERSIONS!;
  const apiVersion = values[apiKey] ?? '67.0';
  // execCmd accepts a shell string, so reject metacharacters and option-like fixture values.
  if (!/^[A-Za-z0-9][A-Za-z0-9_.@+-]{0,254}$/.test(targetOrg))
    throw new Error(
      'FLOW_VERSION_NUT_TARGET_ORG must be a bounded alias or username beginning with an alphanumeric character.'
    );
  if (!/^[A-Za-z][A-Za-z0-9_]{0,254}$/.test(flowApiName))
    throw new Error('FLOW_VERSION_NUT_FLOW must be a qualified Flow API identifier.');
  if (!/^[1-9]\d*(?:,[1-9]\d*)*$/.test(versionText))
    throw new Error('FLOW_VERSION_NUT_VERSIONS must contain comma-separated positive version numbers.');
  const versions = versionText.split(',').map(Number);
  if (
    versions.length > 200 ||
    versions.some((version) => !Number.isSafeInteger(version)) ||
    new Set(versions).size !== versions.length
  )
    throw new Error('FLOW_VERSION_NUT_VERSIONS must contain 1 to 200 distinct safe integer version numbers.');
  if (!/^\d{2,3}\.0$/.test(apiVersion) || Number(apiVersion) < 67)
    throw new Error('FLOW_VERSION_NUT_API_VERSION must be a supported numeric API version such as 67.0.');
  return { targetOrg, flowApiName, versions, apiVersion };
};

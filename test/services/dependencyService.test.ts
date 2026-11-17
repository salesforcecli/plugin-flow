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
import { DependencyService, ToolingQueryClient } from '../../src/services/dependencyService.js';

const CHILD_NAME = 'FlowDependency_POC_Child';
const PARENT_NAME = 'FlowDependency_POC_Parent';
const CHILD_DEFINITION_ID = '300xx000000bojNAAQ';
const PARENT_DEFINITION_ID = '300xx000000bojOAAQ';
const CHILD_VERSION_ID = '301xx000003Ga19AAC';
const PARENT_VERSION_ID = '301xx000003Ga1AAAS';

type DefinitionRecord = {
  Id: string;
  DeveloperName: string;
  NamespacePrefix: string | null;
  ActiveVersionId: string | null;
  LatestVersionId: string | null;
};

type FlowRecord = {
  Id: string;
  DefinitionId: string;
  VersionNumber: number;
  Status: unknown;
  Metadata: unknown;
};

type DependencyRecord = {
  MetadataComponentId: string;
  MetadataComponentName: string;
  MetadataComponentType: string;
  MetadataComponentNamespace: string | null;
  RefMetadataComponentId: string;
  RefMetadataComponentName: string;
  RefMetadataComponentType: string;
  RefMetadataComponentNamespace: string | null;
};

type MockOptions = {
  definitionError?: unknown;
  definitions?: Record<string, DefinitionRecord[]>;
  versions?: Record<string, FlowRecord[]>;
  dependencyRecords?: DependencyRecord[];
  dependencyError?: unknown;
  dependencyFailureFor?: RegExp;
  dependencyDone?: boolean;
  dependencyTotalSize?: number;
  versionError?: unknown;
};

const subflowElement = {
  name: 'Call_POC_Child',
  flowName: CHILD_NAME,
  inputAssignments: [{ name: 'inputText', value: { stringValue: 'Flow dependency POC' } }],
  outputAssignments: [{ name: 'outputText', assignToReference: 'childResult' }],
};

const childDefinition: DefinitionRecord = {
  Id: CHILD_DEFINITION_ID,
  DeveloperName: CHILD_NAME,
  NamespacePrefix: null,
  ActiveVersionId: null,
  LatestVersionId: CHILD_VERSION_ID,
};

const parentDefinition: DefinitionRecord = {
  Id: PARENT_DEFINITION_ID,
  DeveloperName: PARENT_NAME,
  NamespacePrefix: null,
  ActiveVersionId: null,
  LatestVersionId: PARENT_VERSION_ID,
};

const childVersion: FlowRecord = {
  Id: CHILD_VERSION_ID,
  DefinitionId: CHILD_DEFINITION_ID,
  VersionNumber: 1,
  Status: 'Draft',
  Metadata: { subflows: [] },
};

const parentVersion: FlowRecord = {
  Id: PARENT_VERSION_ID,
  DefinitionId: PARENT_DEFINITION_ID,
  VersionNumber: 1,
  Status: 'Draft',
  Metadata: { subflows: [subflowElement] },
};

const dependencyRecord: DependencyRecord = {
  MetadataComponentId: PARENT_DEFINITION_ID,
  MetadataComponentName: PARENT_NAME,
  MetadataComponentType: 'FlowDefinition',
  MetadataComponentNamespace: null,
  RefMetadataComponentId: CHILD_DEFINITION_ID,
  RefMetadataComponentName: CHILD_NAME,
  RefMetadataComponentType: 'FlowDefinition',
  RefMetadataComponentNamespace: null,
};

function rejectNativeQuery(reason: unknown): never {
  // Native API clients can reject with REST error records or arrays instead of Error instances.
  throw reason;
}

function mockQueryClient(options: MockOptions = {}): { client: ToolingQueryClient; queries: string[] } {
  const queries: string[] = [];
  const definitions = options.definitions ?? { [CHILD_NAME]: [childDefinition], [PARENT_NAME]: [parentDefinition] };
  const versions = options.versions ?? {
    [CHILD_VERSION_ID]: [childVersion],
    [PARENT_VERSION_ID]: [parentVersion],
  };
  const client: ToolingQueryClient = {
    async query<T>(soql: string): Promise<{ records: T[]; totalSize?: number; done?: boolean }> {
      queries.push(soql);
      let records: unknown[];
      if (/FROM MetadataComponentDependency\b/i.test(soql)) {
        if (options.dependencyError && (!options.dependencyFailureFor || options.dependencyFailureFor.test(soql))) {
          rejectNativeQuery(options.dependencyError);
        }
        const predicate = /WHERE\s+(MetadataComponentId|RefMetadataComponentId)\s*=\s*'([^']+)'/i.exec(soql);
        if (!predicate) throw new Error(`Unbounded dependency query in test: ${soql}`);
        const field = predicate[1] as 'MetadataComponentId' | 'RefMetadataComponentId';
        records = (options.dependencyRecords ?? []).filter((record) => record[field] === predicate[2]);
        return {
          records: records as T[],
          totalSize: options.dependencyTotalSize ?? records.length,
          done: options.dependencyDone ?? true,
        };
      }
      if (/FROM FlowDefinition\b/i.test(soql)) {
        if (options.definitionError) rejectNativeQuery(options.definitionError);
        const name = /DeveloperName\s*=\s*'([^']+)'/i.exec(soql)?.[1];
        if (!name) throw new Error(`Unbounded FlowDefinition query in test: ${soql}`);
        records = definitions[name] ?? [];
      } else if (/FROM Flow\b/i.test(soql)) {
        if (options.versionError) rejectNativeQuery(options.versionError);
        const id = /WHERE\s+Id\s*=\s*'([^']+)'/i.exec(soql)?.[1];
        if (!id) throw new Error(`Unbounded Flow query in test: ${soql}`);
        records = versions[id] ?? [];
      } else {
        throw new Error(`Unexpected API query in test: ${soql}`);
      }
      return { records: records as T[], totalSize: records.length, done: true };
    },
  };
  return { client, queries };
}

async function expectFailure(action: () => Promise<unknown>, message: RegExp): Promise<void> {
  let failure: unknown;
  try {
    await action();
  } catch (error) {
    failure = error;
  }
  expect(failure, 'expected the analysis to reject').to.be.instanceOf(Error);
  expect((failure as Error).message).to.match(message);
}

describe('DependencyService', () => {
  it('should discover a Draft parent-to-child relationship when the dependency API returns no rows', async () => {
    const { client } = mockQueryClient();
    const result = await new DependencyService(client).analyze({ flowName: PARENT_NAME });

    expect(result.root).to.include({
      flowName: PARENT_NAME,
      namespace: null,
      definitionId: PARENT_DEFINITION_ID,
      versionId: PARENT_VERSION_ID,
      versionNumber: 1,
      status: 'Draft',
    });
    expect(result.relationships).to.have.length(1);
    expect(result.relationships[0]).to.include({
      direction: 'outgoing',
      callerType: 'Flow',
      callerName: PARENT_NAME,
      callerVersion: 1,
      callerStatus: 'Draft',
      targetType: 'FlowDefinition',
      targetName: CHILD_NAME,
      elementName: 'Call_POC_Child',
      evidence: 'Flow.Metadata',
    });
    expect(result.mcd.status).to.equal('success');
    expect(result.mcd.reportedEdges).to.deep.equal([]);
  });

  it('should identify a parent as an incoming caller only within explicitly scanned Flows', async () => {
    const { client } = mockQueryClient();
    const result = await new DependencyService(client).analyze({ flowName: CHILD_NAME, scanFlows: [PARENT_NAME] });

    expect(result.scannedFlows.map((flow) => flow.flowName)).to.have.members([CHILD_NAME, PARENT_NAME]);
    expect(result.relationships).to.have.length(1);
    expect(result.relationships[0]).to.include({
      direction: 'incoming',
      callerName: PARENT_NAME,
      callerVersion: 1,
      callerStatus: 'Draft',
      targetName: CHILD_NAME,
      evidence: 'Flow.Metadata',
    });
    expect(result.root.versionId).to.equal(CHILD_VERSION_ID);
  });

  it('should declare its bounded scope and explicitly disclose that Apex source was not scanned', async () => {
    const { client } = mockQueryClient();
    const result = await new DependencyService(client).analyze({ flowName: CHILD_NAME });

    expect(result.scope).to.include({
      flowMetadata: 'explicit-flows-only',
      orgWideComplete: false,
      apexSourceScanned: false,
    });
    expect(result.scope.requestedFlowNames).to.deep.equal([CHILD_NAME]);
    expect(result.warnings.join(' ')).to.match(/apex/i);
    expect(result.warnings.join(' ')).to.match(/scope|complete|explicit|all.*caller/i);
    expect(result.relationships).to.deep.equal([]);
  });

  it('should issue only bounded read queries and never activate or execute a Flow', async () => {
    const { client, queries } = mockQueryClient();
    await new DependencyService(client).analyze({ flowName: CHILD_NAME, scanFlows: [PARENT_NAME] });

    expect(queries).not.to.be.empty;
    for (const query of queries) {
      expect(query).to.match(/^SELECT /i);
      expect(query).to.match(/\bWHERE\b/i);
      expect(query).to.match(/\bLIMIT\s+\d+$/i);
      expect(query).not.to.match(/\b(?:UPDATE|DELETE|INSERT|UPSERT|EXECUTE|ACTIVATE)\b/i);
      if (/FROM FlowDefinition\b/i.test(query)) expect(query).to.match(/DeveloperName\s*=/i);
      if (/FROM Flow\b/i.test(query)) expect(query).to.match(/WHERE\s+Id\s*=/i);
    }
    expect(queries.some((query) => /FROM ApexClass\b/i.test(query))).to.equal(false);
  });

  it('should default to latest and retain Draft status without requiring an active version', async () => {
    const { client } = mockQueryClient();
    const result = await new DependencyService(client).analyze({ flowName: CHILD_NAME });

    expect(result.versionPolicy).to.equal('latest');
    expect(result.root.status).to.equal('Draft');
    expect(result.root.versionId).to.equal(CHILD_VERSION_ID);
  });

  it('should use the selected active version rather than silently using latest', async () => {
    const activeId = '301xx000003Ga18AAC';
    const { client, queries } = mockQueryClient({
      definitions: { [CHILD_NAME]: [{ ...childDefinition, ActiveVersionId: activeId }] },
      versions: { [activeId]: [{ ...childVersion, Id: activeId, Status: 'Active', VersionNumber: 2 }] },
    });
    const result = await new DependencyService(client).analyze({ flowName: CHILD_NAME, versionPolicy: 'active' });

    expect(result.versionPolicy).to.equal('active');
    expect(result.root).to.include({ versionId: activeId, versionNumber: 2, status: 'Active' });
    expect(queries.filter((query) => /FROM Flow\b/i.test(query))[0]).to.include(activeId);
  });

  it('should reject active policy when the selected Flow has no active version', async () => {
    const { client, queries } = mockQueryClient();
    await expectFailure(
      () => new DependencyService(client).analyze({ flowName: CHILD_NAME, versionPolicy: 'active' }),
      /active/i
    );
    expect(queries.some((query) => /FROM Flow\b/i.test(query))).to.equal(false);
  });

  it('should reject a missing root instead of reporting zero dependencies', async () => {
    const { client } = mockQueryClient({ definitions: {} });
    await expectFailure(() => new DependencyService(client).analyze({ flowName: CHILD_NAME }), /not found|no .*flow/i);
  });

  it('should reject an ambiguous root rather than selecting an arbitrary definition', async () => {
    const { client } = mockQueryClient({ definitions: { [CHILD_NAME]: [childDefinition, childDefinition] } });
    await expectFailure(
      () => new DependencyService(client).analyze({ flowName: CHILD_NAME }),
      /ambiguous|multiple|more than one/i
    );
  });

  it('should reject a missing selected version instead of reporting zero dependencies', async () => {
    const { client } = mockQueryClient({ versions: {} });
    await expectFailure(
      () => new DependencyService(client).analyze({ flowName: CHILD_NAME }),
      /version|not found|no .*flow/i
    );
  });

  it('should reject latest policy when no latest version is available', async () => {
    const { client, queries } = mockQueryClient({
      definitions: { [CHILD_NAME]: [{ ...childDefinition, LatestVersionId: null }] },
    });
    await expectFailure(() => new DependencyService(client).analyze({ flowName: CHILD_NAME }), /latest/i);
    expect(queries.some((query) => /FROM Flow\b/i.test(query))).to.equal(false);
  });

  it('should reject an invalid definition ID returned by the API', async () => {
    const { client } = mockQueryClient({ definitions: { [CHILD_NAME]: [{ ...childDefinition, Id: "bad'id" }] } });
    await expectFailure(() => new DependencyService(client).analyze({ flowName: CHILD_NAME }), /invalid.*id/i);
  });

  it('should reject an invalid selected version ID returned by the API', async () => {
    const { client } = mockQueryClient({
      definitions: { [CHILD_NAME]: [{ ...childDefinition, LatestVersionId: "bad'id" }] },
    });
    await expectFailure(() => new DependencyService(client).analyze({ flowName: CHILD_NAME }), /invalid.*id/i);
  });

  it('should reject a returned version belonging to a different Flow definition', async () => {
    const { client } = mockQueryClient({
      versions: { [CHILD_VERSION_ID]: [{ ...childVersion, DefinitionId: PARENT_DEFINITION_ID }] },
    });
    await expectFailure(() => new DependencyService(client).analyze({ flowName: CHILD_NAME }), /match|definition/i);
  });

  for (const versionNumber of [0, -1, 1.5]) {
    it(`should reject incomplete version identity with version number ${versionNumber}`, async () => {
      const { client } = mockQueryClient({
        versions: { [CHILD_VERSION_ID]: [{ ...childVersion, VersionNumber: versionNumber }] },
      });
      await expectFailure(() => new DependencyService(client).analyze({ flowName: CHILD_NAME }), /version identity/i);
    });
  }

  it('should reject incomplete version identity when status is absent', async () => {
    const { client } = mockQueryClient({
      versions: { [CHILD_VERSION_ID]: [{ ...childVersion, Status: undefined }] },
    });
    await expectFailure(() => new DependencyService(client).analyze({ flowName: CHILD_NAME }), /version identity/i);
  });

  it('should propagate a required Flow read failure', async () => {
    const { client } = mockQueryClient({ versionError: new Error('Required Flow read denied') });
    await expectFailure(
      () => new DependencyService(client).analyze({ flowName: CHILD_NAME }),
      /Required Flow metadata.*could not be read/i
    );
  });

  it('should support a singleton subflow value without losing the relationship', async () => {
    const { client } = mockQueryClient({
      versions: { [PARENT_VERSION_ID]: [{ ...parentVersion, Metadata: { subflows: subflowElement } }] },
    });
    const result = await new DependencyService(client).analyze({ flowName: PARENT_NAME });

    expect(result.relationships).to.have.length(1);
    expect(result.relationships[0]).to.include({ targetName: CHILD_NAME, elementName: 'Call_POC_Child' });
  });

  it('should handle null subflows as no declared subflow elements', async () => {
    const { client } = mockQueryClient({
      versions: { [CHILD_VERSION_ID]: [{ ...childVersion, Metadata: { subflows: null } }] },
    });
    const result = await new DependencyService(client).analyze({ flowName: CHILD_NAME });
    expect(result.relationships).to.deep.equal([]);
  });

  it('should handle absent subflows as no declared subflow elements', async () => {
    const { client } = mockQueryClient({
      versions: { [CHILD_VERSION_ID]: [{ ...childVersion, Metadata: {} }] },
    });
    const result = await new DependencyService(client).analyze({ flowName: CHILD_NAME });
    expect(result.relationships).to.deep.equal([]);
  });

  it('should read Flow Metadata serialized as a JSON object', async () => {
    const { client } = mockQueryClient({
      versions: { [PARENT_VERSION_ID]: [{ ...parentVersion, Metadata: JSON.stringify(parentVersion.Metadata) }] },
    });
    const result = await new DependencyService(client).analyze({ flowName: PARENT_NAME });
    expect(result.relationships).to.have.length(1);
    expect(result.relationships[0]).to.include({ targetName: CHILD_NAME, evidence: 'Flow.Metadata' });
  });

  for (const metadata of [null, [], 'not-json', '[]', 'null']) {
    it(`should reject unreadable Flow Metadata ${JSON.stringify(
      metadata
    )} instead of reporting zero dependencies`, async () => {
      const { client } = mockQueryClient({
        versions: { [CHILD_VERSION_ID]: [{ ...childVersion, Metadata: metadata }] },
      });
      await expectFailure(
        () => new DependencyService(client).analyze({ flowName: CHILD_NAME }),
        /no readable Metadata|cannot be analyzed/i
      );
    });
  }

  it('should warn on a malformed subflow element while retaining readable relationships', async () => {
    const { client } = mockQueryClient({
      versions: {
        [PARENT_VERSION_ID]: [{ ...parentVersion, Metadata: { subflows: [null, { flowName: '' }, subflowElement] } }],
      },
    });
    const result = await new DependencyService(client).analyze({ flowName: PARENT_NAME });
    expect(result.relationships).to.have.length(1);
    expect(result.warnings.join(' ')).to.match(/unreadable subflow target/i);
  });

  it('should trim and deduplicate root and scan names before making queries', async () => {
    const { client, queries } = mockQueryClient();
    const result = await new DependencyService(client).analyze({
      flowName: ` ${CHILD_NAME} `,
      scanFlows: [CHILD_NAME, PARENT_NAME, ` ${PARENT_NAME} `],
    });

    expect(result.scope.requestedFlowNames).to.have.members([CHILD_NAME, PARENT_NAME]);
    expect(result.scope.requestedFlowNames).to.have.length(2);
    expect(result.scannedFlows).to.have.length(2);
    expect(queries.filter((query) => /FROM FlowDefinition\b/i.test(query))).to.have.length(2);
    expect(queries.filter((query) => /FROM Flow\b/i.test(query))).to.have.length(2);
  });

  for (const invalidName of ['', ' ', "MyFlow' OR Id != null", 'MyFlow\\', 'My Flow', 'MyFlow;DELETE']) {
    it(`should reject invalid Flow name ${JSON.stringify(invalidName)} before querying`, async () => {
      const { client, queries } = mockQueryClient();
      await expectFailure(() => new DependencyService(client).analyze({ flowName: invalidName }), /name|invalid|flow/i);
      expect(queries).to.deep.equal([]);
    });
  }

  it('should reject an invalid explicit scan name before querying any Flow', async () => {
    const { client, queries } = mockQueryClient();
    await expectFailure(
      () => new DependencyService(client).analyze({ flowName: CHILD_NAME, scanFlows: ["bad'name"] }),
      /name|invalid|flow/i
    );
    expect(queries).to.deep.equal([]);
  });

  it('should bound the number of explicitly scanned Flows before querying', async () => {
    const { client, queries } = mockQueryClient();
    await expectFailure(
      () =>
        new DependencyService(client).analyze({
          flowName: CHILD_NAME,
          scanFlows: Array.from({ length: 20 }, (_, index) => `ExtraFlow_${index}`),
        }),
      /20|limit|maximum|many/i
    );
    expect(queries).to.deep.equal([]);
  });

  it('should constrain an unnamespaced root to null namespace', async () => {
    const { client, queries } = mockQueryClient();
    await new DependencyService(client).analyze({ flowName: CHILD_NAME });
    const definitionQuery = queries.find((query) => /FROM FlowDefinition\b/i.test(query));
    expect(definitionQuery).to.match(/NamespacePrefix\s*=\s*null/i);
  });

  it('should constrain a namespaced root to the requested namespace', async () => {
    const { client, queries } = mockQueryClient({
      definitions: { [CHILD_NAME]: [{ ...childDefinition, NamespacePrefix: 'acme' }] },
    });
    const result = await new DependencyService(client).analyze({ flowName: CHILD_NAME, namespace: 'acme' });
    const definitionQuery = queries.find((query) => /FROM FlowDefinition\b/i.test(query));
    expect(definitionQuery).to.match(/NamespacePrefix\s*=\s*'acme'/i);
    expect(result.root.namespace).to.equal('acme');
  });

  it('should reject namespace injection before querying', async () => {
    const { client, queries } = mockQueryClient();
    await expectFailure(
      () => new DependencyService(client).analyze({ flowName: CHILD_NAME, namespace: "acme' OR Id != null" }),
      /namespace|name|invalid/i
    );
    expect(queries).to.deep.equal([]);
  });

  it('should report dependency API failure separately from an empty successful result', async () => {
    const { client } = mockQueryClient({ dependencyError: new Error('Dependency API unavailable') });
    const result = await new DependencyService(client).analyze({ flowName: PARENT_NAME });

    expect(result.mcd.status).to.equal('failed');
    expect(result.warnings.join(' ')).to.match(/MetadataComponentDependency.*failed/);
    expect(result.relationships).to.have.length(1);
    expect(result.relationships[0].evidence).to.equal('Flow.Metadata');
    expect(result.scope.orgWideComplete).to.equal(false);
  });

  it('should report partial dependency evidence when one API query fails and the others succeed', async () => {
    const { client } = mockQueryClient({
      dependencyError: new Error('One dependency query failed'),
      dependencyFailureFor: new RegExp(`WHERE RefMetadataComponentId = '${CHILD_DEFINITION_ID}'`),
    });
    const result = await new DependencyService(client).analyze({ flowName: CHILD_NAME });

    expect(result.mcd.status).to.equal('partial');
    expect(result.mcd.queryCount).to.equal(4);
    expect(result.warnings.join(' ')).to.match(/MetadataComponentDependency.*failed/);
  });

  it('should preserve an API-reported Apex caller as supplementary incoming evidence without claiming a source scan', async () => {
    const apexCaller = {
      ...dependencyRecord,
      MetadataComponentId: '01pxx000000AbCdAAK',
      MetadataComponentName: 'CallsPocFlow',
      MetadataComponentType: 'ApexClass',
    };
    const { client } = mockQueryClient({ dependencyRecords: [apexCaller] });
    const result = await new DependencyService(client).analyze({ flowName: CHILD_NAME });

    expect(result.relationships).to.have.length(1);
    expect(result.relationships[0]).to.include({
      direction: 'incoming',
      callerType: 'ApexClass',
      callerName: 'CallsPocFlow',
      targetName: CHILD_NAME,
      evidence: 'MetadataComponentDependency',
    });
    expect(result.scope.apexSourceScanned).to.equal(false);
  });

  it('should flag a saturated dependency query as incomplete without fetching the whole org', async () => {
    const dependencyRecords = Array.from({ length: 200 }, (_, index) => ({
      ...dependencyRecord,
      MetadataComponentName: `Caller_${index}`,
    }));
    const { client, queries } = mockQueryClient({ dependencyRecords });
    const result = await new DependencyService(client).analyze({ flowName: CHILD_NAME });

    expect(result.mcd.status).to.equal('partial');
    expect(result.mcd.limit).to.equal(200);
    expect(result.warnings.join(' ')).to.match(/limit|truncat|incomplete|200/i);
    expect(result.scope.orgWideComplete).to.equal(false);
    expect(queries.filter((query) => /FROM MetadataComponentDependency\b/i.test(query))).to.have.length(4);
  });

  it('should flag a dependency API continuation response as incomplete without silently paging', async () => {
    const { client, queries } = mockQueryClient({ dependencyRecords: [dependencyRecord], dependencyDone: false });
    const result = await new DependencyService(client).analyze({ flowName: CHILD_NAME });

    expect(result.mcd.status).to.equal('partial');
    expect(result.warnings.join(' ')).to.match(/limit|incomplete|continu|partial|done/i);
    expect(queries.filter((query) => /FROM MetadataComponentDependency\b/i.test(query))).to.have.length(4);
  });

  it('should preserve supplementary dependency API evidence and deduplicate repeated records', async () => {
    const { client } = mockQueryClient({ dependencyRecords: [dependencyRecord, dependencyRecord] });
    const result = await new DependencyService(client).analyze({ flowName: CHILD_NAME });

    expect(result.mcd.reportedEdges).to.deep.equal([dependencyRecord]);
    expect(result.mcd.queryCount).to.equal(4);
    expect(result.mcd.status).to.equal('success');
  });
});

describe('DependencyService query diagnostics', () => {
  const unsafeDiagnostics = () =>
    Object.assign(new Error('Authorization: Bearer TEST_SENTINEL https://example.invalid/?password=TEST_SENTINEL'), {
      errorCode: 'INVALID_SESSION_ID',
      statusCode: 401,
      body: '<html>TEST_SENTINEL</html>',
      query: 'SELECT TEST_SENTINEL',
      cause: new Error('refreshToken=TEST_SENTINEL'),
    });

  for (const stage of ['definition', 'version'] as const) {
    it(`sanitizes the required ${stage} read and stops subsequent requests`, async () => {
      const { client, queries } = mockQueryClient({ [`${stage}Error`]: unsafeDiagnostics() });
      let failure: unknown;
      try {
        await new DependencyService(client).analyze({ flowName: CHILD_NAME });
      } catch (error) {
        failure = error;
      }
      expect(failure).to.be.instanceOf(Error);
      const message = (failure as Error).message;
      expect(message).to.include('Required Flow metadata');
      expect(message).to.include('INVALID_SESSION_ID');
      expect(message).to.include('HTTP 401');
      expect(JSON.stringify(failure)).not.to.include('TEST_SENTINEL');
      expect(message).not.to.include('TEST_SENTINEL');
      expect((failure as Error).cause).to.equal(undefined);
      expect(queries).to.have.length(stage === 'definition' ? 1 : 2);
    });
  }

  it('keeps optional-provider failure distinct from no references without returning raw diagnostics', async () => {
    const { client } = mockQueryClient({ dependencyError: unsafeDiagnostics() });
    const report = await new DependencyService(client).analyze({ flowName: PARENT_NAME });
    expect(report.mcd.status).to.equal('failed');
    expect(report.relationships).to.have.length(1);
    expect(report.warnings.join(' ')).to.include('INVALID_SESSION_ID; HTTP 401');
    expect(report.warnings.join(' ')).to.include('results are incomplete');
    expect(JSON.stringify(report)).not.to.include('TEST_SENTINEL');
    expect(JSON.stringify(report)).not.to.include('example.invalid');
  });

  it('does not accept arbitrary strings as trusted error codes or status metadata', async () => {
    const { client } = mockQueryClient({
      dependencyError: {
        errorCode: 'TEST_SENTINEL',
        statusCode: '401 TEST_SENTINEL',
        message: 'TEST_SENTINEL',
        cause: { accessToken: 'TEST_SENTINEL' },
      },
    });
    const report = await new DependencyService(client).analyze({ flowName: CHILD_NAME });
    expect(report.mcd.status).to.equal('failed');
    expect(JSON.stringify(report)).not.to.include('TEST_SENTINEL');
    expect(report.warnings.join(' ')).to.include('Check the org connection');
  });

  it('accepts native error arrays while retaining only allowlisted diagnostics', async () => {
    const { client } = mockQueryClient({ dependencyError: [{ errorCode: 'INVALID_TYPE', message: 'TEST_SENTINEL' }] });
    const report = await new DependencyService(client).analyze({ flowName: CHILD_NAME });
    expect(report.warnings.join(' ')).to.include('(INVALID_TYPE)');
    expect(JSON.stringify(report)).not.to.include('TEST_SENTINEL');
  });
});

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

import { PassThrough } from 'node:stream';
import { expect } from 'chai';
import sinon from 'sinon';
import { Connection, type AuthInfo } from '@salesforce/core';
import { FlowVersionError, FlowVersionListService, ToolingFlowVersionListClient } from '@salesforce/flow-node';

const versionId = (number: number): string => `301${String(number).padStart(12, '0')}AAA`;
const record = (number: number): Record<string, unknown> => ({
  Id: versionId(number),
  DefinitionId: '300000000000001AAA',
  Definition: { DeveloperName: 'Invoice_Approval', NamespacePrefix: null },
  MasterLabel: 'Invoice Approval - Review',
  VersionNumber: number,
  Status: number === 1 ? 'Active' : 'Draft',
  CreatedDate: '2026-01-01T00:00:00.000+0000',
  CreatedById: '005000000000001AAA',
  CreatedBy: { Name: 'Fixture Creator' },
  LastModifiedDate: '2026-01-02T00:00:00.000+0000',
});
type NativeRequest = { method: string; url: string; body?: unknown; headers?: Record<string, string> };
const capturedRequest = (call: sinon.SinonSpyCall): NativeRequest => call.args[0] as NativeRequest;
const assessmentPath = '/services/data/v67.0/connect/interaction/flow-versions/deletion-assessment';
const requestBody = (request: NativeRequest): string => {
  if (request.body === undefined || request.body === null) return '{}';
  if (typeof request.body !== 'string') throw new TypeError('Expected a serialized JSON request body.');
  return request.body;
};
const incomingInterview = {
  sourceId: '0Fo000000000001',
  sourceType: 'FlowInterview',
  sourceName: '00000003',
  targetKind: 'VERSION',
  targetId: versionId(2).slice(0, 15),
  targetName: null,
  channels: ['EXTERNALIZED_REFERENCE'],
  interviewRoles: ['PERSISTED_REFERENCE'],
  detailsRedacted: false,
};

describe('Flow version listing through the installed authenticated Connection', () => {
  const sandbox = sinon.createSandbox();
  afterEach(() => sandbox.restore());

  const connectionWithResponses = async (
    responses: Array<{ statusCode: number; body: unknown }>,
    facts: {
      assessments?: Record<string, Record<string, unknown>>;
      assessmentFailure?: { statusCode: number; body: unknown };
      omitCounts?: boolean;
      omitVersionLimit?: boolean;
      versionLimit?: number;
    } = {}
  ): Promise<{ connection: Connection; request: sinon.SinonStub }> => {
    const connection = new Connection({
      authInfo: {
        getUsername: () => 'unit-test-only@example.invalid',
        getFields: () => ({ orgId: '00D000000000001EAA' }),
      } as AuthInfo,
      connectionOptions: {
        instanceUrl: 'https://flow-list-unit-test.invalid',
        accessToken: 'unit-test-only-not-a-credential',
        version: '67.0',
      },
    });
    await connection.init();
    // Mock below native parsing/authentication. No request reaches a real org.
    // eslint-disable-next-line no-underscore-dangle
    const request = sandbox.stub(connection._transport, 'httpRequest').callsFake((httpRequest: NativeRequest) => {
      const url = new URL(httpRequest.url);
      let response: { statusCode: number; body: unknown } | undefined;
      if (url.pathname === assessmentPath) {
        const body = JSON.parse(requestBody(httpRequest)) as { targets: Array<{ versionId: string }> };
        response = facts.assessmentFailure ?? {
          statusCode: 201,
          body: {
            contractVersion: '1',
            results: body.targets.map((target) => ({
              versionId: target.versionId.slice(0, 15),
              outcome: 'PASS',
              reasonCode: null,
              message: null,
              evidence: [],
              ...(facts.omitCounts
                ? {}
                : { counts: { referenceCount: 0, pausedInterviewCount: 0, failedInterviewCount: 0 } }),
              ...(facts.omitVersionLimit ? {} : { versionLimit: facts.versionLimit ?? 25 }),
              ...(facts.assessments?.[target.versionId.slice(0, 15)] ?? {}),
            })),
          },
        };
      } else {
        response = responses.shift();
      }
      if (!response) throw new Error('Unexpected additional HTTP request');
      return Object.assign(
        Promise.resolve({
          statusCode: response.statusCode,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(response.body),
        }),
        { stream: () => new PassThrough() }
      );
    });
    return { connection, request };
  };

  const assessmentCalls = (request: sinon.SinonStub): NativeRequest[] =>
    request
      .getCalls()
      .map(capturedRequest)
      .filter((call) => new URL(call.url).pathname === assessmentPath);

  const expectOnlyReadAndAssessmentRequests = (request: sinon.SinonStub): void => {
    for (const call of request.getCalls()) {
      const input = capturedRequest(call);
      expect(['GET', 'POST']).to.include(input.method);
      if (input.method === 'POST') expect(new URL(input.url).pathname).to.equal(assessmentPath);
      expect(JSON.stringify(input.headers ?? {}).toLowerCase()).not.to.include('uitier');
      expect(JSON.stringify(input.headers ?? {}).toLowerCase()).not.to.include('lightning');
      expect(new URL(input.url).pathname).not.to.include('/describe');
      const query = new URL(input.url).searchParams.get('q') ?? '';
      for (const obsoleteRead of ['FlowInterview', 'MetadataComponentDependency', 'ManageableState'])
        expect(query).not.to.include(obsoleteRead);
    }
  };

  it('pages native inventory, then accepts HTTP 201 and canonicalizes the backend 15-character result', async () => {
    const { connection, request } = await connectionWithResponses([
      {
        statusCode: 200,
        body: {
          totalSize: 2,
          done: false,
          nextRecordsUrl: '/services/data/v67.0/tooling/query/01g000000000001AAA',
          records: [record(1)],
        },
      },
      { statusCode: 200, body: { totalSize: 2, done: true, records: [record(2)] } },
    ]);
    const report = await new FlowVersionListService(
      new ToolingFlowVersionListClient(connection),
      () => new Date('2026-10-27T00:00:00.000Z')
    ).list({ all: true, status: 'inactive' });
    expect(report).to.include({ contractVersion: '6', totalVersions: 2, matchedVersions: 1 });
    expect(report.rows[0]).to.include({
      versionNumber: 2,
      versionCount: 2,
      versionLimit: 25,
      percentUsed: 8,
      createdByName: 'Fixture Creator',
      versionName: 'Invoice Approval - Review',
    });
    expect(report.rows[0].c1Counts).to.deep.equal({
      referenceCount: 0,
      pausedInterviewCount: 0,
      failedInterviewCount: 0,
    });
    expect(report.rows[0].assessment).to.deep.equal({
      versionId: versionId(2),
      outcome: 'PASS',
      reasonCode: null,
      message: null,
      evidence: [],
      counts: { referenceCount: 0, pausedInterviewCount: 0, failedInterviewCount: 0 },
      versionLimit: 25,
    });
    expect(report.assessmentCounts).to.deep.equal({ pass: 1, blocked: 0, error: 0 });
    expect(report.assessmentErrors).to.deep.equal([]);
    expect(report.countErrors).to.deep.equal([]);
    expect(report.capacityErrors).to.deep.equal([]);
    expect(report.warnings).to.deep.equal([]);
    const posts = assessmentCalls(request);
    expect(posts).to.have.length(1);
    expect(JSON.parse(requestBody(posts[0]))).to.deep.equal({
      contractVersion: '1',
      targets: [{ versionId: versionId(2), expectedDefinitionId: '300000000000001AAA' }],
    });
    const inventory = request
      .getCalls()
      .map(capturedRequest)
      .find((call) => new URL(call.url).searchParams.get('q')?.includes('CreatedBy.Name'));
    expect(inventory).not.to.equal(undefined);
    expect(inventory?.url).not.to.include('Metadata');
    expect(new URL(inventory?.url ?? '').searchParams.get('q')).to.include('MasterLabel');
    expectOnlyReadAndAssessmentRequests(request);
  });

  it('uses complete structured backend counts without inferring totals from the blocker message or evidence', async () => {
    const message = 'PAUSED_INTERVIEWS (2); REFERENCED_BY_VERSION (ParentFlow, OtherFlow)';
    const { connection, request } = await connectionWithResponses(
      [{ statusCode: 200, body: { totalSize: 2, done: true, records: [record(1), record(2)] } }],
      {
        assessments: {
          [versionId(2).slice(0, 15)]: {
            outcome: 'BLOCKED',
            reasonCode: 'PAUSED_INTERVIEWS',
            message,
            evidence: [incomingInterview],
            counts: { referenceCount: 5, pausedInterviewCount: 2, failedInterviewCount: 3 },
          },
        },
      }
    );
    const report = await new FlowVersionListService(new ToolingFlowVersionListClient(connection)).list({ all: true });
    const draft = report.rows.find((row) => row.versionNumber === 2);
    expect(draft?.c1Counts).to.deep.equal({ referenceCount: 5, pausedInterviewCount: 2, failedInterviewCount: 3 });
    expect(draft?.assessment).to.include({ outcome: 'BLOCKED', reasonCode: 'PAUSED_INTERVIEWS', message });
    expect(draft?.assessment.evidence[0]).to.include({
      sourceId: '0Fo000000000001CAA',
      targetId: versionId(2),
      targetName: null,
    });
    expect(draft?.assessment.evidence[0].interviewRoles).to.deep.equal(['PERSISTED_REFERENCE']);
    expectOnlyReadAndAssessmentRequests(request);
  });

  it('retains one per-item ERROR while --deletable still returns the other backend PASS result', async () => {
    const { connection, request } = await connectionWithResponses(
      [{ statusCode: 200, body: { totalSize: 2, done: true, records: [record(1), record(2)] } }],
      {
        assessments: {
          [versionId(1).slice(0, 15)]: {
            outcome: 'ERROR',
            reasonCode: 'OWNED_RESOURCE_CHECK_INCOMPLETE',
            message: null,
            evidence: [],
          },
        },
      }
    );
    const report = await new FlowVersionListService(new ToolingFlowVersionListClient(connection)).list({
      all: true,
      deletable: true,
    });
    expect(report.rows).to.have.length(1);
    expect(report.rows[0].versionNumber).to.equal(2);
    expect(report.rows[0].assessment.outcome).to.equal('PASS');
    expect(report.assessmentErrors).to.have.length(1);
    expect(report.assessmentErrors[0].versionNumber).to.equal(1);
    expect(report.assessmentErrors[0].assessment).to.include({
      outcome: 'ERROR',
      reasonCode: 'OWNED_RESOURCE_CHECK_INCOMPLETE',
      message: null,
    });
    expect(report.assessmentCounts).to.deep.equal({ pass: 1, blocked: 0, error: 1 });
    expect(report.assessmentErrors[0].c1Counts).to.equal(null);
    expect(report.assessmentErrors[0].countError).to.equal(null);
    expect(report.countErrors).to.deep.equal([]);
    expectOnlyReadAndAssessmentRequests(request);
  });

  it('does not override backend PASS with local status, last-version or count rules', async () => {
    const { connection, request } = await connectionWithResponses(
      [{ statusCode: 200, body: { totalSize: 1, done: true, records: [record(1)] } }],
      {
        assessments: {
          [versionId(1).slice(0, 15)]: {
            counts: { referenceCount: 3, pausedInterviewCount: 9, failedInterviewCount: 2 },
          },
        },
      }
    );
    const report = await new FlowVersionListService(new ToolingFlowVersionListClient(connection)).list({
      all: true,
      deletable: true,
    });
    expect(report.rows).to.have.length(1);
    expect(report.rows[0]).to.include({
      status: 'Active',
      versionCount: 1,
    });
    expect(report.rows[0].c1Counts).to.deep.equal({
      referenceCount: 3,
      pausedInterviewCount: 9,
      failedInterviewCount: 2,
    });
    expect(report.rows[0].assessment.outcome).to.equal('PASS');
    expect(report.rows[0]).not.to.have.property('blockingReasons');
    expect(report.rows[0]).not.to.have.property('deletability');
    expectOnlyReadAndAssessmentRequests(request);
  });

  it('retains missing C1 counts as a report error instead of inventing zero or counting evidence', async () => {
    const { connection, request } = await connectionWithResponses(
      [{ statusCode: 200, body: { totalSize: 1, done: true, records: [record(2)] } }],
      { omitCounts: true }
    );
    const report = await new FlowVersionListService(new ToolingFlowVersionListClient(connection)).list({ all: true });
    expect(report.rows[0].assessment.outcome).to.equal('PASS');
    expect(report.rows[0].c1Counts).to.equal(null);
    expect(report.rows[0].countError?.code).to.equal('C1_COUNTS_UNAVAILABLE');
    expect(report.countErrors).to.have.length(1);
    expect(report.rows[0]).not.to.have.property('referenceCount');
    expect(report.rows[0]).not.to.have.property('pausedInterviewCount');
    expectOnlyReadAndAssessmentRequests(request);
  });

  it('uses the backend configured limit rather than a fixed denominator for the utilization filter', async () => {
    await Promise.all(
      [25, 100].map(async (limit) => {
        const { connection, request } = await connectionWithResponses(
          [{ statusCode: 200, body: { totalSize: 2, done: true, records: [record(1), record(2)] } }],
          { versionLimit: limit }
        );
        const report = await new FlowVersionListService(new ToolingFlowVersionListClient(connection)).list({
          all: true,
          minPercent: 5,
        });
        expect(report.rows).to.have.length(limit === 25 ? 2 : 0);
        for (const row of report.rows) {
          expect(row.versionLimit).to.equal(limit);
          expect(row.percentUsed).to.equal(8);
        }
        expect(report.capacityErrors).to.deep.equal([]);
        expect(assessmentCalls(request)).to.have.length(1);
        expectOnlyReadAndAssessmentRequests(request);
      })
    );
  });

  it('retains unavailable configured limits as errors instead of treating them as matching a usage filter', async () => {
    const { connection, request } = await connectionWithResponses(
      [{ statusCode: 200, body: { totalSize: 1, done: true, records: [record(2)] } }],
      { omitVersionLimit: true }
    );
    const report = await new FlowVersionListService(new ToolingFlowVersionListClient(connection)).list({
      all: true,
      minPercent: 80,
    });
    expect(report.rows).to.have.length(0);
    expect(report.capacityErrors).to.have.length(1);
    expect(report.capacityErrors[0]).to.include({ versionLimit: null, percentUsed: null });
    expect(report.capacityErrors[0].capacityError?.code).to.equal('VERSION_LIMIT_UNAVAILABLE');
    expect(report.capacityErrors[0].assessment.outcome).to.equal('PASS');
    expectOnlyReadAndAssessmentRequests(request);
  });

  it('preserves a new server reason and future evidence channel without adding a CLI product branch', async () => {
    const { connection, request } = await connectionWithResponses(
      [{ statusCode: 200, body: { totalSize: 1, done: true, records: [record(2)] } }],
      {
        assessments: {
          [versionId(2).slice(0, 15)]: {
            outcome: 'BLOCKED',
            reasonCode: 'FUTURE_SERVER_RULE',
            message: 'A new backend reason; keep this exact text.',
            evidence: [{ ...incomingInterview, channels: ['ACTIVE_VERSION', 'FUTURE_CHANNEL'] }],
          },
        },
      }
    );
    const report = await new FlowVersionListService(new ToolingFlowVersionListClient(connection)).list({ all: true });
    expect(report.rows[0].assessment).to.include({
      reasonCode: 'FUTURE_SERVER_RULE',
      message: 'A new backend reason; keep this exact text.',
    });
    expect(report.rows[0].assessment.evidence[0].channels).to.deep.equal(['ACTIVE_VERSION', 'FUTURE_CHANNEL']);
    expectOnlyReadAndAssessmentRequests(request);
  });

  it('submits 101 targets as bounded independent batches with no identity, bypass or UI headers', async () => {
    const records = Array.from({ length: 101 }, (_, index) => record(index + 1));
    const { connection, request } = await connectionWithResponses([
      { statusCode: 200, body: { totalSize: 101, done: true, records } },
    ]);
    const report = await new FlowVersionListService(new ToolingFlowVersionListClient(connection)).list({ all: true });
    expect(report.rows).to.have.length(101);
    expect(report.assessmentCounts.pass).to.equal(101);
    const posts = assessmentCalls(request);
    expect(posts.map((call) => (JSON.parse(requestBody(call)) as { targets: unknown[] }).targets.length)).to.deep.equal(
      [100, 1]
    );
    for (const call of posts) {
      const body = JSON.parse(requestBody(call)) as {
        contractVersion: string;
        targets: Array<Record<string, unknown>>;
      };
      expect(Object.keys(body).sort()).to.deep.equal(['contractVersion', 'targets']);
      expect(body.contractVersion).to.equal('1');
      for (const target of body.targets)
        expect(Object.keys(target).sort()).to.deep.equal(['expectedDefinitionId', 'versionId']);
    }
    expectOnlyReadAndAssessmentRequests(request);
  });

  it('propagates a native HTTP 400 assessment rejection without a positive fallback or DELETE', async () => {
    const { connection, request } = await connectionWithResponses(
      [{ statusCode: 200, body: { totalSize: 1, done: true, records: [record(2)] } }],
      {
        assessmentFailure: {
          statusCode: 400,
          body: [{ errorCode: 'BAD_REQUEST', message: 'contractVersion must be "1"' }],
        },
      }
    );
    let caught: unknown;
    try {
      await new FlowVersionListService(new ToolingFlowVersionListClient(connection)).list({ all: true });
    } catch (error) {
      caught = error;
    }
    expect(caught).to.be.instanceOf(Error);
    expect(caught).to.have.property('code', 'BAD_REQUEST');
    expect((caught as Error).message).to.include('contractVersion must be "1"');
    expect(assessmentCalls(request)).to.have.length(1);
    expectOnlyReadAndAssessmentRequests(request);
  });

  it('returns a safe typed inventory permission error before submitting any assessment', async () => {
    const { connection, request } = await connectionWithResponses([
      {
        statusCode: 403,
        body: [{ errorCode: 'INSUFFICIENT_ACCESS_OR_READONLY', message: 'Fixture denies Flow access.' }],
      },
    ]);
    let caught: unknown;
    try {
      await new FlowVersionListService(new ToolingFlowVersionListClient(connection)).list({ all: true });
    } catch (error) {
      caught = error;
    }
    expect(caught).to.be.instanceOf(FlowVersionError);
    expect((caught as FlowVersionError).code).to.equal('INVENTORY_REQUEST_FAILED');
    expect((caught as Error).message).to.include('INSUFFICIENT_ACCESS_OR_READONLY');
    expect((caught as Error).message).not.to.include('Fixture denies Flow access');
    expect(assessmentCalls(request)).to.have.length(0);
  });

  it('propagates an HTTP 503 assessment failure instead of manufacturing per-item outcomes or retrying', async () => {
    const { connection, request } = await connectionWithResponses(
      [{ statusCode: 200, body: { totalSize: 1, done: true, records: [record(2)] } }],
      {
        assessmentFailure: {
          statusCode: 503,
          body: [{ errorCode: 'SERVER_UNAVAILABLE', message: 'Assessment service temporarily unavailable.' }],
        },
      }
    );
    let caught: unknown;
    try {
      await new FlowVersionListService(new ToolingFlowVersionListClient(connection)).list({ all: true });
    } catch (error) {
      caught = error;
    }
    expect(caught).to.be.instanceOf(Error);
    expect(assessmentCalls(request)).to.have.length(1);
    expectOnlyReadAndAssessmentRequests(request);
  });

  it('rejects an unsafe selector before native HTTP', async () => {
    const { connection, request } = await connectionWithResponses([]);
    let caught: unknown;
    try {
      await new FlowVersionListService(new ToolingFlowVersionListClient(connection)).list({
        flowName: "Invoice' OR Id != null",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).to.be.instanceOf(Error);
    expect(request.called).to.equal(false);
  });
});

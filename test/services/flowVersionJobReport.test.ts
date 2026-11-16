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
import { ConnectFlowVersionPruneJobClient, FlowVersionError } from '@salesforce/flow-node';
import { loadFlowVersionJobReport } from '../../src/services/flowVersionJobReport.js';

const jobId = '08P000000000001';
const deleted = 'Invoice 301000000000001 DELETED';

describe('Flow version job report detail loader', () => {
  const sandbox = sinon.createSandbox();
  let request: sinon.SinonStub;
  let getOperation: sinon.SinonStub;
  let connection: Connection;

  beforeEach(() => {
    request = sandbox.stub().resolves({ Status: 'Complete', Result: deleted, Error: null });
    connection = { request, getApiVersion: () => '69.0' } as unknown as Connection;
    getOperation = sandbox
      .stub(ConnectFlowVersionPruneJobClient.prototype, 'getOperation')
      .resolves({ jobId, status: 'Complete' });
  });

  afterEach(() => sandbox.restore());

  for (const result of [undefined, null, 'MASKED', '']) {
    it(`reads the stored terminal details when the Connect result is ${String(result)}`, async () => {
      getOperation.resolves({ jobId, status: 'Complete', ...(result === undefined ? {} : { result }) });
      expect(await loadFlowVersionJobReport(connection, jobId)).to.deep.equal({
        jobId,
        status: 'Complete',
        result: deleted,
        error: null,
      });
      expect(getOperation.calledOnceWithExactly(jobId)).to.equal(true);
      expect(
        request.calledOnceWithExactly(
          {
            method: 'GET',
            url: `/services/data/v69.0/sobjects/BackgroundOperation/${jobId}?fields=Status,Result,Error`,
          },
          { retry: { methods: [], maxRetries: 0 }, followRedirect: false }
        )
      ).to.equal(true);
    });
  }

  it('reads Error even when Connect returned result text and uses the stored snapshot together', async () => {
    getOperation.resolves({ jobId, status: 'Complete', result: deleted });
    request.resolves({ Status: 'Error', Result: null, Error: 'The job failed while reading versions.' });
    expect(await loadFlowVersionJobReport(connection, jobId)).to.deep.equal({
      jobId,
      status: 'Error',
      result: null,
      error: 'The job failed while reading versions.',
    });
  });

  it('preserves an Error job with an empty result and the exact exception text', async () => {
    getOperation.resolves({ jobId, status: 'Error' });
    request.resolves({ Status: 'Error', Result: '', Error: 'Could not lock the Flow definition.' });
    expect(await loadFlowVersionJobReport(connection, jobId)).to.deep.equal({
      jobId,
      status: 'Error',
      result: '',
      error: 'Could not lock the Flow definition.',
    });
  });

  for (const status of ['Scheduled', 'Running'] as const) {
    it(`returns only ${status} status without reading or inferring partial outcomes`, async () => {
      getOperation.resolves({ jobId, status, result: deleted });
      expect(await loadFlowVersionJobReport(connection, jobId)).to.deep.equal({
        jobId,
        status,
        result: null,
        error: null,
      });
      expect(request.called).to.equal(false);
    });
  }

  it('ignores a partial result if the stored snapshot is Running', async () => {
    request.resolves({ Status: 'Running', Result: deleted, Error: null });
    expect(await loadFlowVersionJobReport(connection, jobId)).to.deep.equal({
      jobId,
      status: 'Running',
      result: null,
      error: null,
    });
  });

  it('only exposes Error when the stored status is Error', async () => {
    request.resolves({ Status: 'Complete', Result: deleted, Error: 'Old error text must not be exposed.' });
    expect((await loadFlowVersionJobReport(connection, jobId)).error).to.equal(null);
  });

  for (const result of [null, '']) {
    it(`preserves a valid empty stored result ${String(result)} without inventing deletion results`, async () => {
      request.resolves({ Status: 'Complete', Result: result, Error: null });
      expect((await loadFlowVersionJobReport(connection, jobId)).result).to.equal(result);
    });
  }

  for (const response of [
    null,
    [],
    { Result: deleted, Error: null },
    { Status: 'Unexpected', Result: deleted, Error: null },
    { Status: 'Complete', Error: null },
    { Status: 'Complete', Result: deleted },
    { Status: 'Complete', Result: 1, Error: null },
    { Status: 'Error', Result: null, Error: {} },
    { Status: 'Complete', Result: 'MASKED', Error: null },
  ]) {
    it(`rejects malformed or inaccessible stored result data: ${JSON.stringify(response)}`, async () => {
      request.resolves(response);
      let error: unknown;
      try {
        await loadFlowVersionJobReport(connection, jobId);
      } catch (caught) {
        error = caught;
      }
      expect(error).to.be.instanceOf(FlowVersionError).and.have.property('code', 'INVALID_FLOW_JOB_REPORT_RESPONSE');
      expect(request.calledOnce).to.equal(true);
    });
  }

  it('propagates a native record-read failure without retry or a success-shaped report', async () => {
    const error = new Error('The BackgroundOperation record is not accessible.');
    request.rejects(error);
    let actual: unknown;
    try {
      await loadFlowVersionJobReport(connection, jobId);
    } catch (caught) {
      actual = caught;
    }
    expect(actual).to.equal(error);
    expect(request.calledOnce).to.equal(true);
    expect(getOperation.calledOnce).to.equal(true);
  });

  it('does not perform a fallback read when the existing SDK rejects the job id', async () => {
    const error = new FlowVersionError('INVALID_PRUNE_JOB_ID', 'Invalid job id.');
    getOperation.rejects(error);
    let actual: unknown;
    try {
      await loadFlowVersionJobReport(connection, '../jobs');
    } catch (caught) {
      actual = caught;
    }
    expect(actual).to.equal(error);
    expect(request.called).to.equal(false);
  });
});

describe('Flow version job report through the installed authenticated Connection', () => {
  const sandbox = sinon.createSandbox();
  afterEach(() => sandbox.restore());

  type Reply = { statusCode: number; body: unknown };
  type Request = { method: string; url: string; body?: string; headers?: Record<string, string> };
  const setup = async (replies: Reply[]) => {
    const connection = new Connection({
      authInfo: {
        getUsername: () => 'job-report-unit@example.invalid',
        getFields: () => ({ orgId: '00D000000000001EAA' }),
      } as AuthInfo,
      connectionOptions: {
        instanceUrl: 'https://job-report-unit.invalid',
        accessToken: 'unit-test-only-not-a-credential',
        version: '69.0',
      },
    });
    await connection.init();
    // eslint-disable-next-line no-underscore-dangle
    const request = sandbox.stub(connection._transport, 'httpRequest').callsFake(() => {
      const reply = replies.shift();
      if (!reply) throw new Error('Unexpected extra request');
      return Object.assign(
        Promise.resolve({
          statusCode: reply.statusCode,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(reply.body),
        }),
        { stream: () => new PassThrough() }
      );
    });
    return { connection, request };
  };

  it('reads the stored fields with the same authentication and no polling or mutations', async () => {
    const { connection, request } = await setup([
      { statusCode: 200, body: { status: 'Complete', result: 'MASKED' } },
      { statusCode: 200, body: { Status: 'Complete', Result: deleted, Error: null } },
    ]);
    expect(await loadFlowVersionJobReport(connection, jobId)).to.deep.equal({
      jobId,
      status: 'Complete',
      result: deleted,
      error: null,
    });
    const requests = request.getCalls().map((call) => call.args[0] as Request);
    expect(requests.map(({ method }) => method)).to.deep.equal(['GET', 'GET']);
    expect(requests.map(({ url }) => url)).to.deep.equal([
      `https://job-report-unit.invalid/services/data/v69.0/xds/operation/${jobId}`,
      `https://job-report-unit.invalid/services/data/v69.0/sobjects/BackgroundOperation/${jobId}?fields=Status,Result,Error`,
    ]);
    for (const call of request.getCalls()) {
      expect((call.args[0] as Request).headers?.Authorization).to.equal('Bearer unit-test-only-not-a-credential');
      expect((call.args[0] as Request).body).to.equal(undefined);
      expect(call.args[1]).to.include({ followRedirect: false });
      expect((call.args[1] as { retry: unknown }).retry).to.deep.equal({ methods: [], maxRetries: 0 });
    }
  });

  it('propagates a forbidden record read without retrying or reporting all versions deleted', async () => {
    const { connection, request } = await setup([
      { statusCode: 200, body: { status: 'Complete', result: 'MASKED' } },
      { statusCode: 403, body: [{ errorCode: 'INSUFFICIENT_ACCESS', message: 'Record access denied.' }] },
    ]);
    let error: unknown;
    try {
      await loadFlowVersionJobReport(connection, jobId);
    } catch (caught) {
      error = caught;
    }
    expect(error).to.be.instanceOf(Error).and.have.property('message', 'Record access denied.');
    expect(request.callCount).to.equal(2);
    expect(request.getCalls().map((call) => (call.args[0] as Request).method)).to.deep.equal(['GET', 'GET']);
  });
});

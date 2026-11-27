import { DBOS } from '@dbos-inc/dbos-sdk';
import { APICallError } from 'ai';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { launchTestWorkflows, testDb, type TestDb } from '../../test/helpers.ts';
import { extract } from '../ai/index.ts';
import { mockModel } from '../ai/mock.ts';
import { executorId, QUEUE, retryWorkflow } from './index.ts';

const ran = { first: 0, second: 0 };
let failSecond = true;

const twoSteps = DBOS.registerWorkflow(
  async (input: string) => {
    const a = await DBOS.runStep(async () => {
      ran.first++;
      return `${input}:first`;
    }, { name: 'first' });
    return DBOS.runStep(async () => {
      ran.second++;
      if (failSecond) throw new Error('second step fails once');
      return `${a}:second`;
    }, { name: 'second' });
  },
  { name: 'twoSteps' },
);

// A paid call inside a step, as every module makes one. DBOS stores a failed step's error with its causes.
const SECRET = 'approved fact 4000 NPR and an uploaded file';
const modelStep = DBOS.registerWorkflow(
  async (brandId: string) =>
    DBOS.runStep(() => extract({ brandId, runType: 'test', runId: 'r', system: 's', parts: [{ type: 'text', text: SECRET }], schema: z.object({}) }), { name: 'call' }),
  { name: 'modelStep' },
);

let t: TestDb;
let stop: () => Promise<void>;
beforeAll(async () => {
  t = await testDb();
  stop = await launchTestWorkflows(t);
});
afterAll(async () => {
  await stop();
  await t.close();
});

describe('workflows', () => {
  it('names each pm2 instance its own executor, so one never recovers the workflows another is running', () => {
    expect(DBOS.executorID).toBe('local');
    expect([executorId('0'), executorId('1'), executorId(undefined)]).toEqual(['api-0', 'api-1', 'local']);
  });

  it('retries from the failed step without re-running the first', async () => {
    const handle = await DBOS.startWorkflow(twoSteps, { queueName: QUEUE })('run');
    await expect(handle.getResult()).rejects.toThrow('second step fails once');
    expect((await handle.getStatus())?.status).toBe('ERROR');

    failSecond = false;
    const retried = await retryWorkflow<string>(handle.workflowID);
    expect(await retried.getResult()).toBe('run:first:second');
    expect(ran).toEqual({ first: 1, second: 2 });
  });

  it('stores no prompt with the error of a failed model call', async () => {
    const brand = await t.makeBrand();
    vi.spyOn(mockModel as any, 'doGenerate').mockRejectedValueOnce(new APICallError({
      message: 'Overloaded', url: 'https://api.example/v1/messages', requestBodyValues: { messages: [{ content: SECRET }] },
      statusCode: 529, responseBody: '{"error":"overloaded"}', isRetryable: false,
    }));
    const handle = await DBOS.startWorkflow(modelStep, { queueName: QUEUE })(brand);
    await expect(handle.getResult()).rejects.toThrow('The model call failed: Overloaded');
    const stored = await t.adminQuery(`select error from dbos.operation_outputs where workflow_uuid = $1 union all select error from dbos.workflow_status where workflow_uuid = $1`, [handle.workflowID]);
    expect(stored.length).toBeGreaterThan(0);
    expect(JSON.stringify(stored)).not.toContain(SECRET);
  });
});

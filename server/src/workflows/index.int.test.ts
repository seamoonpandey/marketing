import { DBOS } from '@dbos-inc/dbos-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchTestWorkflows, testDb, type TestDb } from '../../test/helpers.ts';
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
});

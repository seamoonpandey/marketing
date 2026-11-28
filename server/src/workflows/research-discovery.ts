// The discovery run (spec §5.2): wait for the owner to confirm the estimate, then search the web and Maps for each
// keyword. The run ID is the DBOS workflow ID.
import { DBOS } from '@dbos-inc/dbos-sdk';
import type { SearchResult } from '../db/schema/research.ts';
import { setDiscoveryState } from '../domain/research/discovery/run.ts';
import { loadDiscovery, runSearch, saveResults, searchAgain, type Searched } from '../domain/research/discovery/steps.ts';
import { runError } from './index.ts';

const APPROVAL_WAIT_SECONDS = 7 * 86_400;
const KINDS = ['web', 'places'] as const;

export const discoveryWorkflow = DBOS.registerWorkflow(
  async (brandId: string, runId: string): Promise<void> => {
    try {
      // Nothing is searched or sent to a model before the owner confirms.
      if (!(await DBOS.recv<string>('approval', APPROVAL_WAIT_SECONDS))) {
        await DBOS.runStep(() => setDiscoveryState(brandId, runId, 'cancelled', { error: 'Not approved in time' }), { name: 'expire' });
        return;
      }
      const { keywords, country } = await DBOS.runStep(() => loadDiscovery(brandId, runId), { name: 'load' });
      const queries = keywords.flatMap((query, i) => KINDS.map((kind) => ({ i, query, kind })));
      // One step per query, so a retry or a recovery repeats no paid query.
      let answers: Searched[] = [];
      for (const q of queries)
        answers.push(await DBOS.runStep(() => runSearch(brandId, runId, q.query, q.kind, country), { name: `search:${q.i}:${q.kind}` }));
      if (answers.every((a) => a.failed)) answers = await DBOS.runStep(() => searchAgain(brandId, runId, queries, country), { name: 'search:again' });

      const results: SearchResult[] = [];
      answers.forEach((a, n) => {
        for (const h of a.hits) results.push({ ...h, id: `r${results.length + 1}`, kind: queries[n]!.kind, query: queries[n]!.query });
      });
      await DBOS.runStep(() => saveResults(brandId, runId, results), { name: 'save' });

      await DBOS.runStep(
        () => setDiscoveryState(brandId, runId, 'completed', {
          counts: { queries: queries.length, failedQueries: answers.filter((a) => a.failed).length, results: results.length },
        }),
        { name: 'finish' },
      );
    } catch (e) {
      // A cancelled workflow cannot run steps; setDiscoveryState only touches runs that are still active.
      await DBOS.runStep(() => setDiscoveryState(brandId, runId, 'failed_retryable', { error: runError(e) }), { name: 'fail' }).catch(() => {});
      throw e;
    }
  },
  { name: 'researchDiscovery' },
);

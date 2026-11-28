// The discovery run (spec §5.2): wait for the owner to confirm the estimate, search the web and Maps for each keyword,
// group the results into businesses, describe each one, then the brand itself. The run ID is the DBOS workflow ID.
import { DBOS } from '@dbos-inc/dbos-sdk';
import { AiError } from '../ai/index.ts';
import type { SearchResult } from '../db/schema/research.ts';
import { matchKey } from '../domain/research/discovery/match.ts';
import { setDiscoveryState } from '../domain/research/discovery/run.ts';
import {
  fillOwnRow, groupResults, loadDiscovery, profileBusiness, runSearch, saveResults, searchAgain, type Searched,
} from '../domain/research/discovery/steps.ts';
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

      const counts = {
        queries: queries.length, failedQueries: answers.filter((a) => a.failed).length, results: results.length,
        found: 0, skipped: 0, profiled: 0, failedProfiles: 0, dropped: 0,
      };
      if (results.length) {
        const { businesses, skipped } = await DBOS.runStep(() => groupResults(brandId, runId, results), { name: 'group' });
        Object.assign(counts, { found: businesses.length, skipped });
        // One step per business, so one refusal loses one row and a retry repeats no profile already made.
        for (const b of businesses) {
          const r = await DBOS.runStep(() => profileBusiness(brandId, runId, b, results), { name: `profile:${matchKey(b)}` });
          if ('failed' in r) counts.failedProfiles++;
          else {
            counts.profiled++;
            counts.dropped += r.dropped;
          }
        }
        await DBOS.runStep(() => fillOwnRow(brandId, runId), { name: 'own' });
      }
      await DBOS.runStep(() => setDiscoveryState(brandId, runId, 'completed', { counts }), { name: 'finish' });
    } catch (e) {
      // A refusal or an off-schema answer comes back the same, so a retry would only pay for it again.
      const to = e instanceof AiError && !e.retryable ? 'failed_final' : 'failed_retryable';
      // A cancelled workflow cannot run steps; setDiscoveryState only touches runs that are still active.
      await DBOS.runStep(() => setDiscoveryState(brandId, runId, to, { error: runError(e) }), { name: 'fail' }).catch(() => {});
      throw e;
    }
  },
  { name: 'researchDiscovery' },
);

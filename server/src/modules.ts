// The one list of module routers and workflows. Each router is mounted under /api and declares full
// paths after it: /brands/{brandId}/knowledge/… and /brands/{brandId}/research/…. Importing a workflow
// file registers its DBOS workflows, which must happen before launchWorkflows() in main.ts.
import { routes as knowledge } from './domain/knowledge/index.ts';
import { routes as plan } from './domain/plan/index.ts';
import { routes as studio } from './domain/studio/index.ts';
import { routes as research } from './domain/research/index.ts';
import { routes as approve } from './domain/approve/index.ts';
import { routes as publish } from './domain/publish/index.ts';
import './workflows/brand-import.ts';
import './workflows/plan-draft.ts';
import './workflows/research-watch.ts';
import './workflows/studio-run.ts';
import './workflows/publish-run.ts';

export const moduleRoutes = [knowledge, research, plan, studio, approve, publish];

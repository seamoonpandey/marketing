// Module 1 (brand branch): facts, import, palette, readiness, brand book.

/** Routes under /api/brands/{brandId}/knowledge/…, mounted by src/modules.ts. */
export { routes } from './routes.ts';
export { CATALOGUE, fieldDef, sectionDef, type FieldDef, type SectionDef, type SectionKey } from './catalogue.ts';
export {
  approveBatch, approvedFacts, approveFact, editFact, enterFact, factHistory, findOrCreateSubject, listFacts, listSubjects,
  proposeFacts, rejectFact, resolveConflict, type Fact, type ProposedFact, type Subject,
} from './facts/index.ts';
export { listAssets } from './assets.ts';
export { contrast, getPalette } from './palette/index.ts';

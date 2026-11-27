import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    schemaSql: string[];
  }
}

// drizzle-kit/api adds enumerable properties to Array and String prototypes (which breaks pdf.js),
// so the schema SQL is generated here, outside the test workers, once per run.
export default async function setup(project: TestProject) {
  const { generateDrizzleJson, generateMigration } = await import('drizzle-kit/api');
  const schema = await import('../src/db/schema/index.ts');
  project.provide('schemaSql', await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema)));
}

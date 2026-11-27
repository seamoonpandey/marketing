// Request and response schemas of GET /api/brands/{brandId}/home.
import { z } from '@hono/zod-openapi';
import { namedMoney } from './common.ts';

export const modules = ['publish', 'approve', 'studio', 'plan', 'research', 'brand'] as const;
export const urgencies = ['now', 'today', 'soon', 'later'] as const;

const iso = z.string().openapi({ example: '2026-11-27T06:00:00.000Z', description: 'ISO 8601 timestamp' });
const HomeMoney = namedMoney('HomeMoney');

export const Module = z.enum(modules).openapi('HomeModule', { description: 'The module that owns the item. `brand` is the knowledge module.' });
export const Urgency = z.enum(urgencies).openapi('HomeUrgency');

export const Item = z
  .object({
    kind: z.string().openapi({ description: 'What sort of thing it is, for example `publish_manual` or `facts_review`.' }),
    module: Module,
    title: z.string(),
    detail: z.string().openapi({ description: 'One plain sentence saying why it needs attention.' }),
    count: z.number().int().nullable().openapi({ description: 'How many things the item stands for; null for a single thing.' }),
    due: iso.nullable(),
    urgency: Urgency,
    href: z.string().openapi({ description: 'The app path that deals with it.' }),
  })
  .openapi('HomeItem');

export const Home = z
  .object({
    brand: z.object({ id: z.string(), name: z.string(), timezone: z.string() }),
    now: iso,
    items: z.array(Item).openapi({ description: 'Most urgent first.' }),
    upcoming: z.array(z.object({ title: z.string(), at: iso, href: z.string() })).openapi({ description: 'The next posts to go out, soonest first.' }),
    partial: z.array(Module).openapi({ description: 'Modules that did not answer; their items are left out.' }),
    paused: z.object({ reason: z.string().nullable(), at: iso.nullable() }).nullable().openapi({ description: 'Set while the brand is paused in Approve.' }),
    modules: z.array(z.object({ module: Module, status: z.string().nullable().openapi({ description: 'Null when the module did not answer.' }), href: z.string() })),
    costs: z
      .object({
        month: z.string(),
        total: HomeMoney,
        byModule: z.array(z.object({ module: z.enum(['brand', 'research', 'plan', 'studio']), cost: HomeMoney })),
      })
      .nullable()
      .openapi({ description: 'This month (UTC). Null when the costs could not be read.' }),
  })
  .openapi('Home');

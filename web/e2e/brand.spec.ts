import { expect, test, type Page } from '@playwright/test';
import { aiCalls, clearPages, fixtureUrl, queueAi, resetAi, setPage } from './helpers';

const NEPALI = 'हिमालयको चिसोमा न्यानो पश्मिना, हातले बुनेको र नेपालमै बनाइएको';
const NAME = 'Himalayan Pashmina Shawl';
const doc = (body: string) => `<html><head><title>Himal Pashmina</title></head><body>${body}</body></html>`;

test.describe('brand onboarding, real API and mock model', () => {
  test.beforeEach(async () => {
    await clearPages();
    await resetAi();
    await setPage('/', doc('<h1>Himal Pashmina</h1><p>Hand-woven pashmina from Kathmandu.</p><a href="/products">Products</a> <a href="/about">About</a>'));
    await setPage('/products', doc(`<h1>${NAME}</h1><p>The ${NAME} costs NPR 4,500 online.</p>`));
    await setPage('/about', doc(`<h1>About us</h1><p>${NAME} is priced at NPR 5,000 in our shop.</p><p>${NEPALI}</p><p>Our shawls keep Kathmandu winters bearable.</p>`));
  });

  const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Brand' }).getByRole('link', { name });
  const row = (page: Page, name: string | RegExp) => page.locator('[data-fact-row]').filter({ has: page.getByRole('heading', { name }) });
  const score = async (page: Page) => Number(await page.getByLabel(/Score \d+ out of 100/).innerText());

  test('import, review, resolve the price conflict, assign roles and watch the score move', async ({ page }) => {
    test.setTimeout(180_000);
    const name = `Himal Pashmina ${Date.now()}`;
    await page.goto('/app/brands/new');
    await page.getByLabel('Brand name').fill(name);
    await page.getByLabel(/Website/).fill(fixtureUrl('/'));
    await page.getByRole('button', { name: 'Add brand' }).click();
    await expect(page).toHaveURL(/\/brand$/);
    const brandId = page.url().match(/\/b\/([^/]+)\/brand/)![1]!;
    await expect(page.getByLabel(/Score \d+ out of 100/)).toBeVisible();
    const before = await score(page);

    await nav(page, 'Sources').click();
    await expect(page.getByLabel('Website address')).toHaveValue(fixtureUrl('/'));
    await page.getByLabel('Choose files to upload').setInputFiles({
      name: 'price-list.txt', mimeType: 'text/plain', buffer: Buffer.from('Industry: Handwoven pashmina textiles, Kathmandu\n'),
    });
    await expect(page.getByRole('list', { name: 'Uploaded files' })).toContainText('price-list.txt');
    await expect(page.getByRole('list', { name: 'Uploaded files' }).getByRole('checkbox', { name: /price-list.txt/ })).toBeChecked();
    await page.getByRole('button', { name: 'Start import' }).click();

    // The fetch is free; the estimate comes next and waits for the owner.
    const confirm = page.getByRole('region', { name: 'Confirm the cost' });
    await expect(confirm).toBeVisible({ timeout: 60_000 });
    await expect(confirm).toContainText('NPR');
    expect(await aiCalls()).toBe(0);

    // The model refers to a source by the ID the run gave it, so read them now and queue the answer.
    const sources: { id: string; uri: string; kind: string; meta: object }[] = await (await page.request.get(`/api/brands/${brandId}/sources`)).json();
    const id = (part: string) => sources.find((s) => s.uri.endsWith(part) || (s.meta as { filename?: string }).filename === part)!.id;
    const product = { section: 'products', subjectName: NAME, language: 'en', origin: 'stated', confidence: 0.9, unit: 'NPR', field: 'price' };
    await queueAi({
      facts: [
        { ...product, value: 4500, sourceId: id('/products'), quote: `The ${NAME} costs NPR 4,500 online.` },
        { ...product, value: 5000, sourceId: id('/about'), quote: `${NAME} is priced at NPR 5,000 in our shop.` },
        { section: 'products', subjectName: NAME, field: 'name', value: NAME, language: 'en', origin: 'stated', confidence: 0.95, sourceId: id('/products'), quote: `The ${NAME} costs NPR 4,500 online.` },
        { section: 'products', subjectName: NAME, field: 'description', value: 'A warm shawl for Kathmandu winters.', language: 'en', origin: 'stated', confidence: 0.5, sourceId: id('/about'), quote: 'Every shawl is warm enough for any Kathmandu winter.' },
        { section: 'positioning', field: 'value_proposition', value: NEPALI, language: 'ne', origin: 'stated', confidence: 0.8, sourceId: id('/about'), quote: NEPALI },
        { section: 'identity', field: 'industry', value: 'Handwoven pashmina textiles', language: 'en', origin: 'stated', confidence: 0.9, sourceId: id('price-list.txt'), quote: 'Industry: Handwoven pashmina textiles, Kathmandu' },
      ],
    });
    await confirm.getByRole('button', { name: 'Confirm and start' }).click();
    const result = page.getByRole('region', { name: 'Import result' });
    await expect(result).toBeVisible({ timeout: 60_000 });
    expect(await aiCalls()).toBeGreaterThan(0);
    await result.getByRole('link', { name: /Review the facts/ }).click();

    // The conflict is pinned above everything, in the section that has it.
    await expect(page).toHaveURL(/review/);
    const conflict = page.locator('[data-conflict]');
    await expect(conflict).toBeVisible();
    await expect(conflict).toContainText('NPR 4500');
    await expect(conflict).toContainText('NPR 5000');
    const [c, f] = [await conflict.boundingBox(), await row(page, 'Name').boundingBox()];
    expect(c!.y).toBeLessThan(f!.y);

    // A quote-checked fact shows its source and quote; the inferred one its warning.
    const nameRow = row(page, 'Name');
    await expect(nameRow).toContainText(`“The ${NAME} costs NPR 4,500 online.”`);
    await expect(nameRow.getByRole('link', { name: /Himal Pashmina/ })).toHaveAttribute('href', fixtureUrl('/products'));
    const inferred = row(page, 'Description');
    await expect(inferred.getByText('Inferred')).toBeVisible();
    await expect(inferred).toContainText('Prachaar worked this out');

    // Resolve: keep one price.
    await conflict.getByRole('button', { name: /Keep NPR 4500/ }).click();
    await expect(page.locator('[data-conflict]')).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);

    // Approve, then edit the same fact twice: every action makes a new fact ID.
    await page.getByRole('button', { name: `Approve ${NAME}, Name` }).click();
    await expect(row(page, 'Name')).toHaveCount(0);
    await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: /^Approved/ }).click();
    await expect(row(page, 'Name').getByText('Approved')).toBeVisible();
    for (const text of ['Himalayan Pashmina Shawl (classic)', 'Himalayan Pashmina Shawl (classic, 2)']) {
      await page.getByRole('button', { name: `Edit ${NAME}, Name` }).click();
      await page.getByLabel('Value for Name').fill(text);
      await page.getByRole('button', { name: 'Save and approve' }).click();
      await expect(row(page, 'Name')).toContainText(text);
    }
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: /^To review/ }).click();

    // "Approve all shown" in Identity and Positioning, with the Nepali value shown whole.
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Positioning' }).click();
    await expect(page.locator('[data-fact-row] p[lang="ne"]').first()).toHaveText(NEPALI);
    await page.getByRole('button', { name: /^Approve all shown/ }).click();
    await page.getByRole('button', { name: /^Yes, approve/ }).click();
    await expect(page.getByText(/^Approved \d+ facts?\.$/)).toBeVisible();
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /^Identity/ }).click();
    await page.getByRole('button', { name: /^Approve all shown/ }).click();
    await page.getByRole('button', { name: /^Yes, approve/ }).click();
    await expect(page.getByText(/^Approved \d+ facts?\.$/)).toBeVisible();

    // A goal, and three competitors.
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Goals and economics' }).click();
    await page.getByLabel('Value for Primary objective').fill('Sell more shawls in Kathmandu');
    await page.getByRole('button', { name: 'Add and approve' }).click();
    await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: /^Approved/ }).click();
    await expect(page.locator('[data-fact-row]')).toContainText('Sell more shawls');
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Competitors' }).click();
    for (const n of ['Kashmir Looms', 'Everest Wool', 'Lhasa Weaves']) {
      const form = page.getByRole('region', { name: 'Competitors' }).locator('form');
      await form.getByLabel('Name', { exact: true }).fill(n);
      await form.getByLabel('Website', { exact: true }).fill(`${n.toLowerCase().replace(' ', '')}.example`);
      await form.getByRole('button', { name: 'Add competitor' }).click();
      await expect(page.getByRole('list', { name: 'Competitors' })).toContainText(n);
    }

    // Palette roles on the visual screen (colours are added by hand: the fixture has no logo).
    await nav(page, 'Visual identity').click();
    for (const [hex, role] of [['#24201d', 'text'], ['#f5efe5', 'background']] as const) {
      await page.getByLabel(/^Add a colour/).fill(hex);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await page.getByLabel(`Role of ${hex}`).selectOption(role);
    }
    await page.getByRole('button', { name: 'Save palette' }).click();
    await expect(page.getByRole('list', { name: 'Contrast pairs' })).toContainText(':1');

    await nav(page, 'Brand book').click();
    await expect.poll(() => score(page)).toBeGreaterThan(before);
    await expect(page.getByRole('heading', { name: /Himalayan Pashmina Shawl \(classic, 2\)|Pashmina/ }).first()).toBeVisible();
  });
});

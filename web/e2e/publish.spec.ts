import { test } from '@playwright/test';

// Runs after Approve, Studio and the Publish server are merged; it needs a real approved draft.
test.describe.skip('publish, full flow against the real API', () => {
  test('add a manual channel, schedule an approved draft, post it by hand and confirm with the link', async ({ page }) => {
    // 1. Create a brand and an approved, ready draft (Studio and Approve fixtures).
    // 2. /publish/channels: add an Instagram channel.
    // 3. /publish/calendar: schedule the draft to it inside the publishing window.
    // 4. Wait for the every-minute scheduler: the job reaches awaiting_manual and shows on /publish.
    // 5. Open the job, copy the caption, download the media, paste a link, confirm: the job is published.
    await page.goto('/app/brands');
  });
});

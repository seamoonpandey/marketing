import { test } from '@playwright/test';

// Runs after Studio and the Approve server are merged: it needs a real ready draft from Studio.
test.describe.skip('approve full flow (real API)', () => {
  test('a ready draft is previewed, approved, edited, and its approval is undone', async ({ page }) => {
    // 1. Seed a brand, a plan item and a Studio draft marked ready (mock model).
    // 2. Open /approve: the draft is waiting. Open it: the preview shows its copy and renders.
    // 3. Approve: the state is approved. Edit the draft in Studio: the queue shows it waiting at a new version.
    // 4. Pause the brand: an approved draft shows paused. Resume with a reason.
    // 5. Reject a second draft with a reason and see it in the history.
    void page;
  });
});

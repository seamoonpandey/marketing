// Module 5, Approve.
export { routes } from './routes.ts';
export { getSettings, setPaused, setSettings, type ApproveSettings } from './settings.ts';
// The gate: every module that publishes must call validApproval and publish nothing for a draft unless it returns an approval.
export { validApproval } from './decisions.ts';
export type { Approval } from './state.ts';
export { queue } from './queue.ts';

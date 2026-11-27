'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

/** A write that refreshes everything the module caches for the brand (`root` is its query key prefix), so no screen shows stale rows. */
export function useAct<V = void, R = unknown>(root: readonly unknown[], fn: (v: V) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => client.invalidateQueries({ queryKey: root }) });
}

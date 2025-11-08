import { useSyncExternalStore } from 'react';

export type SetState<T> = (partial: Partial<T> | ((state: T) => Partial<T>), replace?: boolean) => void;
export type GetState<T> = () => T;
export type StateCreator<T> = (set: SetState<T>, get: GetState<T>) => T;

export interface StoreApi<T> {
  getState: GetState<T>;
  setState: SetState<T>;
  subscribe: (listener: () => void) => () => void;
}

export const createStore = <T>(creator: StateCreator<T>): StoreApi<T> => {
  let state: T;
  const listeners = new Set<() => void>();

  const setState: SetState<T> = (partial, replace = false) => {
    const nextState = typeof partial === 'function'
      ? (partial as (state: T) => Partial<T>)(state)
      : partial;
    const current = state;
    const base = (current as Record<string, unknown> | undefined) ?? {};
    const patch = (nextState as Record<string, unknown> | undefined) ?? {};
    const merged = replace ? (nextState as T) : ({ ...base, ...patch } as T);
    if (Object.is(current, merged)) {
      return;
    }
    state = merged;
    listeners.forEach(listener => listener());
  };

  const getState: GetState<T> = () => state;

  state = creator(
    (partial, replace) => {
      setState(partial as any, replace);
    },
    getState,
  );

  return {
    getState,
    setState,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

export function useStore<T, U = T>(store: StoreApi<T>, selector?: (state: T) => U): U {
  const snapshot = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return selector ? selector(snapshot) : ((snapshot as unknown) as U);
}

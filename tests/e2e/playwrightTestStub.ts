import { afterEach, beforeEach, describe, it, expect as vitestExpect } from 'vitest';

type TestFn = (name: string, fn: () => any | Promise<any>) => void;

type DescribeFn = (name: string, fn: () => void) => void;

type HookFn = (fn: () => any | Promise<any>) => void;

interface PlaywrightLikeTest extends TestFn {
  describe: DescribeFn;
  beforeEach: HookFn;
  afterEach: HookFn;
}

const testFn = ((name: string, fn: () => any | Promise<any>) => it(name, fn)) as PlaywrightLikeTest;

testFn.describe = (name: string, fn: () => void) => describe(name, fn);

testFn.beforeEach = (fn: () => any | Promise<any>) => beforeEach(fn);

testFn.afterEach = (fn: () => any | Promise<any>) => afterEach(fn);

export const test = testFn;

export const expect = vitestExpect;

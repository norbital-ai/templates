import { Effect } from 'effect';
import { render } from 'svelte/server';
import { runningFibers } from '@norbital-ai/ui/effect';
import type { Read } from '@norbital-ai/bolt/page';
import PortalLive from './portal-live-harness.svelte';

const query: Read<string | null> = Object.assign(Effect.die('SSR started a browser read'), {
	read: { m: 'read' as const, a: ['services', { all: true }] }
});
const before = runningFibers();
const rendered = render(PortalLive, { props: { query, initial: 'Server answer' } });

export const body = rendered.body;
export const fibers = runningFibers() - before;

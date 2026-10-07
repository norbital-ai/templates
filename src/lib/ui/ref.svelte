<script lang="ts" module>
	import { bolt } from '$bolt';
	import { idsOf } from '@norbital-ai/ui';

	/**
	 * An exclusive arc's cell (`{ collection, id }`) shows its row's label, never an id: the ids a view renders are read
	 * once per collection in one batch, and remembered. A one-relation column shows its label by default (ui's Table).
	 */
	const all = { all: true } as const;
	const labelled = (rows: readonly { readonly id: string; readonly label: unknown }[]) =>
		rows.map((r) => [r.id, String(r.label ?? r.id)] as const);
	/** Each referenced collection's label read: the ids a cell holds are that collection's. */
	const LABELS = {
		accounts: async (ids: readonly string[]) =>
			labelled(
				(
					await bolt.read('accounts', {
						select: { name: true },
						where: { id: { in: idsOf<'accounts'>(ids) } },
						...all
					})
				).rows.map((r) => ({ id: r.id, label: r.name }))
			),
		quotes: async (ids: readonly string[]) =>
			labelled(
				(
					await bolt.read('quotes', {
						select: { doc_no: true },
						where: { id: { in: idsOf<'quotes'>(ids) } },
						...all
					})
				).rows.map((r) => ({ id: r.id, label: r.doc_no }))
			),
		purchase_orders: async (ids: readonly string[]) =>
			labelled(
				(
					await bolt.read('purchase_orders', {
						select: { doc_no: true },
						where: { id: { in: idsOf<'purchase_orders'>(ids) } },
						...all
					})
				).rows.map((r) => ({ id: r.id, label: r.doc_no }))
			),
		purchase_invoices: async (ids: readonly string[]) =>
			labelled(
				(
					await bolt.read('purchase_invoices', {
						select: { doc_no: true },
						where: { id: { in: idsOf<'purchase_invoices'>(ids) } },
						...all
					})
				).rows.map((r) => ({ id: r.id, label: r.doc_no }))
			)
	};
	export type Referenced = keyof typeof LABELS;
	const referenced = (c: string): c is Referenced => Object.hasOwn(LABELS, c);
	const known = new Map<string, string>();
	const waiting = new Map<Referenced, Set<string>>();
	const listeners = new Set<() => void>();

	function want(of: Referenced, id: string) {
		if (known.has(`${of}/${id}`)) return;
		// A batch is pending exactly while ids wait: the timer that takes them empties `waiting`.
		const idle = waiting.size === 0;
		(waiting.get(of) ?? waiting.set(of, new Set()).get(of)!).add(id);
		if (!idle) return;
		setTimeout(async () => {
			const batch = [...waiting];
			waiting.clear();
			await Promise.all(
				batch.map(async ([c, ids]) => {
					for (const [id, label] of await LABELS[c]([...ids])) known.set(`${c}/${id}`, label);
				})
			).catch(() => undefined);
			for (const run of listeners) run();
		}, 10);
	}
</script>

<script lang="ts">
	import { onDestroy } from 'svelte';
	import * as Predicate from '../guards.js';

	let { id: value }: { id: unknown } = $props();
	const arc = $derived(Predicate.isExclusiveArc(value) ? value : null);
	const collection = $derived(arc?.collection ?? '');
	const id = $derived(arc?.id ?? value);
	let tick = $state(0);
	const run = () => tick++;
	listeners.add(run);
	onDestroy(() => listeners.delete(run));
	const key = $derived(Predicate.isString(id) ? `${collection}/${id}` : null);
	$effect(() => {
		if (Predicate.isString(id) && referenced(collection)) want(collection, id);
	});
	const text = $derived(tick >= 0 && key !== null ? (known.get(key) ?? '…') : '—');
</script>

{text}

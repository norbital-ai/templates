<script lang="ts">
	/**
	 * A subject's `facts`, edited against one declared schema of the lineage's version in force on a
	 * day: a company's `facts`, terms' `terms_facts`, a day's `work_day_facts`, a payment's
	 * `payment_facts`, a non-contract obligation's `settlement_facts`. Only the declared schemas are read: whole version rows run to megabytes.
	 */
	import { bolt } from '$bolt';
	import type { CustomFieldView } from '@norbital-ai/ui';
	import EntityFactsRenderer from '../../data/custom_field/entity_facts/+renderer.svelte';
	import type { FactKey } from '../datatypes/fact_keys.js';
	import { settingsInForce } from '../jurisdiction_settings.js';
	import { todayKey } from './calendar.js';
	import { liveRows } from './live.svelte.js';
	import { inForceSettings } from './settings-scope.js';

	type Schema = 'facts' | 'terms_facts' | 'work_day_facts' | 'payment_facts' | 'settlement_facts';
	let {
		view,
		settingsCode,
		schema,
		day
	}: {
		view: CustomFieldView<{ readonly [key: string]: string | number | boolean }>;
		settingsCode: string | null | undefined;
		schema: Schema;
		/** The day whose version governs; today where the subject names none yet. */
		day?: string | null | undefined;
	} = $props();
	const on = $derived(day || todayKey());
	const versions = liveRows<
		Parameters<typeof settingsInForce>[0][number] & { readonly [S in Schema]?: readonly FactKey[] }
	>(() =>
		settingsCode
			? bolt.read('jurisdiction_settings', {
					where: inForceSettings(settingsCode, on),
					select: {
						code: true,
						name: true,
						sealed_at: true,
						voided_at: true,
						approval_id: true,
						effective_range: true,
						facts: true,
						terms_facts: true,
						work_day_facts: true,
						payment_facts: true,
						settlement_facts: true
					},
					all: true
				})
			: null
	);
	const declarations = $derived(
		settingsInForce(versions.current ?? [], settingsCode ?? '', on)?.[schema] ?? []
	);
</script>

<EntityFactsRenderer {view} {declarations} />

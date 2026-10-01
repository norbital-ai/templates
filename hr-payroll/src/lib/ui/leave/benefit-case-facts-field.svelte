<script lang="ts">
	/**
	 * A benefit case's declared inputs, edited against the case type its employment's lineage
	 * declares (`payroll.benefit_cases`) on the case day: the case's `facts`, or a cutoff's employee
	 * premium share per scheme the case type nets full pay of.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import type { CustomFieldView } from '@norbital-ai/ui';
	import EntityFactsRenderer from '../../../data/custom_field/entity_facts/+renderer.svelte';
	import type { FactKey } from '../../datatypes/fact_keys.js';
	import { todayKey } from '../calendar.js';
	import { live } from '../live.svelte.js';
	import { caseTypes } from './case-types.svelte.js';

	let {
		view,
		employmentId,
		caseType,
		day,
		planId,
		schema
	}: {
		view: CustomFieldView<{ readonly [key: string]: string | number | boolean }>;
		employmentId?: Id<'employments'> | null | undefined;
		caseType?: string | null | undefined;
		/** The case day; today where the case names none yet. */
		day?: string | null | undefined;
		/** A cutoff's plan: its case supplies the employment, case type and day. */
		planId?: Id<'benefit_case_plans'> | null | undefined;
		schema: 'facts' | 'premium_shares';
	} = $props();
	const plan = live(() =>
		planId ? bolt.get('benefit_case_plans', planId, { benefit_case_id: true }) : null
	);
	const planCase = live(() =>
		plan.current?.benefit_case_id
			? bolt.get('benefit_cases', plan.current.benefit_case_id, {
					employment_id: true,
					case_type: true,
					event_on: true,
					expected_event_on: true,
					application_on: true
				})
			: null
	);
	const employmentOf = $derived(employmentId ?? planCase.current?.employment_id);
	const typeCode = $derived(caseType ?? planCase.current?.case_type);
	const on = $derived(
		day ||
			(planCase.current == null
				? null
				: String(
						planCase.current.event_on ??
							planCase.current.expected_event_on ??
							planCase.current.application_on
					)) ||
			todayKey()
	);
	const types = caseTypes(
		() => employmentOf,
		() => on
	);
	const type = $derived(types.current.find((row) => row.case_type === typeCode));
	const declarations = $derived<readonly FactKey[]>(
		schema === 'facts'
			? (type?.facts ?? [])
			: (type?.premium_schemes ?? []).map((key) => ({ key, type: 'number' as const, minimum: 0 }))
	);
</script>

<EntityFactsRenderer {view} {declarations} />

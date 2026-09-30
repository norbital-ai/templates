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
	import type { BenefitCaseType, PayrollSettings } from '../../datatypes/payroll_settings.js';
	import { settingsInForce } from '../../jurisdiction_settings.js';
	import { todayKey } from '../calendar.js';
	import { live, liveRows } from '../live.svelte.js';
	import { inForceSettings } from '../settings-scope.js';

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
	const employment = live(() =>
		employmentOf
			? bolt.get('employments', employmentOf as Id<'employments'>, { company_id: true })
			: null
	);
	const company = live(() =>
		employment.current?.company_id
			? bolt.get('companies', employment.current.company_id, { settings_code: true })
			: null
	);
	const code = $derived(company.current?.settings_code);
	const versions = liveRows(() =>
		code
			? bolt.read('jurisdiction_settings', {
					where: inForceSettings(code, on),
					select: {
						code: true,
						name: true,
						sealed_at: true,
						voided_at: true,
						approval_id: true,
						effective_range: true,
						payroll: true
					},
					all: true
				})
			: null
	);
	const type = $derived(
		(
			((settingsInForce(versions.current ?? [], code ?? '', on)?.payroll as PayrollSettings | null)
				?.benefit_cases ?? []) as readonly BenefitCaseType[]
		).find((row) => row.case_type === typeCode)
	);
	const declarations = $derived<readonly FactKey[]>(
		schema === 'facts'
			? (type?.facts ?? [])
			: (type?.premium_schemes ?? []).map((key) => ({ key, type: 'number' as const, minimum: 0 }))
	);
</script>

<EntityFactsRenderer {view} {declarations} />

<script lang="ts">
	/**
	 * The facts owed before the next payroll run of one legal entity: every declared input its run would refuse on
	 * (`lib/facts-owed.ts`, the list the run's precheck refuses with). The month defaults to the one after the entity's
	 * latest run. Each row is fixed on its own record; the queue empties as the records are completed.
	 */
	import { bolt } from '$bolt';
	import { AppShell, Stack } from '@norbital-ai/ui/layout';
	import ScopeGate from '../../../lib/ui/ScopeGate.svelte';
	import CompanyScope from '../../../lib/ui/CompanyScope.svelte';
	import MonthPeriodPicker from '../../../lib/ui/month-period-picker.svelte';
	import { companyScope } from '../../../lib/ui/company-scope.svelte.js';
	import { todayKey } from '../../../lib/ui/calendar.js';
	import { liveRows } from '../../../lib/ui/live.svelte.js';
	import { onLineage } from '../../../lib/ui/settings-scope.js';
	import { everyField } from '../../../lib/every-field.js';
	import { entityFactsOwed } from '../../../lib/facts-owed.js';
	import { settingsInForce } from '../../../lib/jurisdiction_settings.js';
	import { referenceCodes } from '../../../lib/expressions/functions/tables.js';
	import { live } from '../../../lib/payroll/run/effective.js';
	import { addDays, monthBounds, periodMonth } from '../../../lib/payroll/run/dates.js';
	import type { FactKey } from '../../../lib/datatypes/fact_keys.js';

	const scope = companyScope();
	const company = $derived(scope.company);
	const companyId = $derived(company?.id ?? null);
	const code = $derived(company?.settings_code ?? null);

	const runs = liveRows<{ period: string }>(() =>
		companyId == null
			? null
			: bolt.read('payroll_runs', {
					where: { company_id: { eq: companyId } },
					select: { period: true },
					orderBy: { period: 'desc' },
					limit: 1
				} as never)
	);
	let chosen = $state<string | null>(null);
	const month = $derived(
		chosen ??
			(runs.current?.[0] == null
				? String(todayKey()).slice(0, 7)
				: addDays(monthBounds(periodMonth(runs.current[0].period)).end, 1).slice(0, 7))
	);
	const window = $derived(monthBounds(month));

	type Version = Parameters<typeof settingsInForce>[0][number] & {
		readonly id: string;
		readonly facts?: readonly FactKey[];
		readonly terms_facts?: readonly FactKey[];
		readonly person_facts?: readonly FactKey[];
	};
	const versions = liveRows<Version>(() =>
		code == null
			? null
			: bolt.read('jurisdiction_settings', {
					where: onLineage(code),
					select: {
						id: true,
						code: true,
						sealed_at: true,
						voided_at: true,
						approval_id: true,
						effective_range: true,
						facts: true,
						terms_facts: true,
						person_facts: true
					},
					all: true
				})
	);
	const versionIds = $derived((versions.current ?? []).map((row) => row.id));
	const referenceRows = liveRows<{
		settings_id: string;
		table: string;
		code: string;
		parent_code: string | null;
		effective_range: unknown;
	}>(() =>
		versionIds.length === 0
			? null
			: bolt.read('reference_rows', {
					where: { settings_id: { in: versionIds } } as never,
					select: { settings_id: true, table: true, code: true, parent_code: true, effective_range: true },
					all: true
				})
	);
	const revisions = liveRows<{ id: string; facts: Record<string, unknown>; effective_range: unknown }>(() =>
		companyId == null
			? null
			: bolt.read('company_facts', {
					where: { company_id: { eq: companyId } },
					select: { id: true, facts: true, effective_range: true },
					all: true
				} as never)
	);
	const employments = liveRows(() =>
		companyId == null
			? null
			: bolt.read('employments', {
					where: { company_id: { eq: companyId } },
					select: everyField('employments'),
					all: true
				})
	);
	const employmentIds = $derived(live(employments.current ?? []).map((row) => String(row.id)));
	const employeeIds = $derived([
		...new Set(live(employments.current ?? []).map((row) => String(row.employee_id)))
	]);
	const employees = liveRows(() =>
		employeeIds.length === 0
			? null
			: bolt.read('employees', {
					where: { id: { in: employeeIds } } as never,
					select: everyField('employees'),
					all: true
				})
	);
	const terms = liveRows(() =>
		employmentIds.length === 0
			? null
			: bolt.read('employment_terms', {
					where: { employment_id: { in: employmentIds } } as never,
					select: everyField('employment_terms'),
					all: true
				})
	);
	const termIds = $derived((terms.current ?? []).map((row) => String(row.id)));
	const personFacts = liveRows(() =>
		employeeIds.length === 0
			? null
			: bolt.read('person_facts', {
					where: { employee_id: { in: employeeIds } } as never,
					select: everyField('person_facts'),
					all: true
				})
	);
	const evidence = liveRows<{ fact_key: string; subject: { collection: string; id: string } }>(() =>
		termIds.length === 0
			? null
			: bolt.read('fact_evidence', {
					where: { subject: { employment_terms: { in: termIds } } } as never,
					select: { fact_key: true, subject: true },
					all: true
				})
	);

	const loaded = $derived(
		company != null &&
			versions.current != null &&
			revisions.current != null &&
			employments.current != null &&
			(employeeIds.length === 0 || (employees.current != null && personFacts.current != null)) &&
			(employmentIds.length === 0 || terms.current != null)
	);
	const owed = $derived.by(() => {
		if (!loaded || company == null || code == null) return [];
		const lineage = versions.current ?? [];
		const byVersion = Map.groupBy(referenceRows.current ?? [], (row) => row.settings_id);
		return entityFactsOwed({
			asOf: window.end,
			window,
			versionOn: (day) => settingsInForce(lineage, code, day),
			company: {
				id: String(company.id),
				name: company.name,
				settings_code: code,
				region: company.region ?? null,
				pay_frequency: company.pay_frequency,
				facts: company.facts
			},
			companyFactRevisions: live(revisions.current ?? []),
			employments: live(employments.current ?? []) as never,
			employees: (employees.current ?? []) as never,
			terms: live(terms.current ?? []) as never,
			personFacts: live(personFacts.current ?? []) as never,
			evidence: new Set(
				(evidence.current ?? []).map((row) => `${row.subject.collection}:${row.subject.id}:${row.fact_key}`)
			),
			codesOn: (day) =>
				referenceCodes(byVersion.get(settingsInForce(lineage, code, day)?.id ?? '') ?? [], day)
		});
	});
</script>

<AppShell
	icon="lucide:clipboard-list"
	title="Facts owed"
	description="The declared facts the next payroll run will refuse on, until each is recorded"
>
	{#snippet actions()}
		<MonthPeriodPicker {month} onMonthChange={(next) => (chosen = next)} ariaLabel="Pay period" />
		<CompanyScope {scope} />
	{/snippet}
	<ScopeGate {scope} empty="No entity to check yet.">
		{#snippet children()}
			<Stack gap="sm">
				{#if !loaded}
					<p class="text-sm text-muted-foreground">Checking the declared facts…</p>
				{:else if owed.length === 0}
					<p class="text-sm text-muted-foreground">
						Nothing owed: the {month} run has every declared fact it needs.
					</p>
				{:else}
					<p class="text-sm">{owed.length} fact(s) owed before the {month} run.</p>
					<table class="w-full text-sm">
						<thead class="text-left text-muted-foreground">
							<tr><th>Who</th><th>Fact</th><th>Why</th><th>Record on</th></tr>
						</thead>
						<tbody>
							{#each owed as fact (`${fact.collection}:${fact.id}:${fact.label}:${fact.key}`)}
								<tr class="border-t border-border align-top">
									<td>{fact.label}</td>
									<td>{fact.key}</td>
									<td>{fact.message}</td>
									<td>{fact.collection.replaceAll('_', ' ')}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</Stack>
		{/snippet}
	</ScopeGate>
</AppShell>

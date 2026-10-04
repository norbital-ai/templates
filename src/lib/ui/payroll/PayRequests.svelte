<script lang="ts">
	/**
	 * One legal entity's pay requests of one family (claims, ad hoc payments) for one pay period, stepped in the entity's
	 * own grammar: the period's entries are those pinned to it, or unpinned and dated inside its window. Rows held under
	 * an approval are listed, not hidden (this is the screen an approver works from), and a held or payroll-captured row
	 * says why it is locked.
	 */
	import { t } from '../i18n/t.js';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { EmptyState, Table } from '@norbital-ai/ui';
	import Loading from './Loading.svelte';
	import { payRequestRecordMetadata } from '../scheduling/lock.js';
	import CompanyScope from '../scopes/CompanyScope.svelte';
	import { companyScope, employmentNames } from '../scopes/company-scope.svelte.js';
	import MonthPeriodPicker from '../components/month-period-picker.svelte';
	import { createPayPeriodScope } from '../scopes/pay-period-scope.svelte.js';

	let {
		collection,
		dateLabel,
		title,
		description,
		icon
	}: {
		collection: 'claim_requests' | 'adhoc_requests';
		dateLabel: string;
		title: string;
		description: string;
		icon: string;
	} = $props();
	const scope = companyScope();
	const pay = createPayPeriodScope(() => scope.company);
	const person = employmentNames(() => scope.id);
	type Row = {
		readonly approval_id: string | null;
		readonly payslip_id: unknown;
		readonly pay_period: string | null;
	};
	const lock = (row: Row) =>
		payRequestRecordMetadata(
			row.approval_id,
			row.payslip_id == null ? [] : [{ period: row.pay_period ?? '' }],
			t
		)[0]?.reason ?? '';
</script>

{#snippet personCell({ value }: { value: unknown })}{person(value)}{/snippet}
{#snippet lockCell({ row }: { row: Row })}<span class="text-xs text-muted-foreground"
		>{lock(row)}</span
	>{/snippet}

<AppShell {icon} {title} {description}>
	{#snippet actions()}
		<MonthPeriodPicker
			month={pay.period}
			halves={pay.halves}
			weeks={pay.weeks}
			ariaLabel={t('app.events.pay_period')}
			onMonthChange={(next) => pay.select(next)}
		/>
		<CompanyScope {scope} />
	{/snippet}
	{#if scope.unknown}
		<Loading />
	{:else if scope.id == null}
		<EmptyState title={t('app.events.empty_scope')} />
	{:else if pay.window != null}
		{#key `${scope.id}:${pay.period}`}
			{@const where = {
				employment_id: { is: { company_id: { eq: scope.id } } },
				or: [{ pay_period: { eq: pay.period } }, { pay_period: { isNull: true } }]
			} as const}
			{@const window = { gte: pay.window.start, lte: pay.window.end }}
			<!-- repository-health:allow UI17 -- the tables' `key`, never shown -->
			{@const key = `${collection}-${scope.id}-${pay.period}`}
			<!-- An unpinned request settles in the period its own date falls in: the date column is the family's. -->
			{#if collection === 'claim_requests'}
				<Table
					of="claim_requests"
					{key}
					toolbar={{ title }}
					where={{
						...where,
						or: [where.or[0], { ...where.or[1], incurred_on: window }]
					}}
					orderBy={{ incurred_on: 'desc' }}
					columns={[
						{ field: 'catalogue_id', label: t('component.component') },
						{ field: 'employment_id', label: t('component.person'), cell: personCell },
						{ field: 'amount', label: t('component.amount') },
						{ field: 'as_adjustment_entry', label: t('component.as_adjustment_entry') },
						{ field: 'incurred_on', label: dateLabel },
						{ field: 'evidence_file', label: t('component.evidence_file') },
						{ field: 'approval_id', label: '', cell: lockCell }
					]}
				/>
			{:else}
				<Table
					of="adhoc_requests"
					{key}
					toolbar={{ title }}
					where={{
						...where,
						or: [where.or[0], { ...where.or[1], event_date: window }]
					}}
					orderBy={{ event_date: 'desc' }}
					columns={[
						{ field: 'catalogue_id', label: t('component.component') },
						{ field: 'employment_id', label: t('component.person'), cell: personCell },
						{ field: 'amount', label: t('component.amount') },
						{ field: 'as_adjustment_entry', label: t('component.as_adjustment_entry') },
						{ field: 'event_date', label: dateLabel },
						{ field: 'evidence_file', label: t('component.evidence_file') },
						{ field: 'approval_id', label: '', cell: lockCell }
					]}
				/>
			{/if}
		{/key}
	{/if}
</AppShell>

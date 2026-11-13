<script lang="ts">
	/**
	 * A new stint with its first terms and statutory parameters, in one write: a hire or a rehire, or (given the stint
	 * the person leaves) a transfer, which ends that stint the day before and starts the next under the other company
	 * on the terms carried over. A transfer's loans move with the person under the same law, and are settled or opened
	 * again under another.
	 */
	import type { Id, PlainDate } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Button,
		Combobox,
		confirm_action,
		Editor,
		is_json_schema,
		Label,
		notify_outcome,
		Sheet,
		toast,
		type Value
	} from '@norbital-ai/ui';
	import { run } from '@norbital-ai/ui/effect';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import { DateTime } from 'effect';
	import { inForce } from '../../dated.js';
	import { accountsOf, latestLeft } from '../../ledger/core.js';
	import { parametersChange, termsChange } from '../../person.js';
	import { jsonObject, type Json, type JsonObject } from '../../payroll_engine/foundation.js';
	import { pageLaws } from '../law.svelte.js';
	import { PAID_QUESTION, paidPeriods } from '../payroll/paid_period.svelte.js';
	import { categoryValues } from './contract_categories.js';
	import ContractTermsEditor, { datedKind } from './contract_terms_editor.svelte';
	import type { PersonRead, StintRow } from './person_read.svelte.js';
	import { outstandingOf, transferOrSettleLoans } from './stint_loans.js';

	let {
		ctx,
		person,
		read,
		from = null,
		onclose
	}: {
		ctx: PageContext;
		person: Id<'employee_profile'>;
		read: PersonRead;
		/** The stint a transfer leaves. */
		from?: StintRow | null;
		onclose: () => void;
	} = $props();
	const t: PageContext['t'] = (key, vars) => ctx.t(key, vars);
	const today = ctx.clock('day').today;
	const paid = paidPeriods(ctx);
	const laws = pageLaws(ctx, () => null);
	const codeOf = (entity: unknown) => read.company(entity)?.settings_code;
	/** The months a transfer can start: this one, if no run has taken it, and the year ahead. */
	const months = Array.from({ length: 13 }, (_, index) => {
		const first = DateTime.formatIsoDateUtc(
			DateTime.add(DateTime.startOf(DateTime.makeUnsafe(today), 'month'), { months: index })
		);
		return { value: first, label: first.slice(0, 7) };
	});

	let entity = $state<Id<'entity'> | null>(null);
	// a hire starts on its own day; a transfer on the first of a month
	let firstDay = $state<PlainDate | null>(from === null ? today : (months[1]?.value ?? null));
	let serviceStart = $state<PlainDate | null>(null);
	let termsEdit = $state<Value | null>(null);
	let parametersEdit = $state<Value | null>(null);
	let settleLoans = $state(false);
	let note = $state('');
	let saving = $state(false);
	let failure = $state<string | null>(null);

	const lastDay = $derived(
		from === null || firstDay === null
			? null
			: DateTime.formatIsoDateUtc(DateTime.subtract(DateTime.makeUnsafe(firstDay), { days: 1 }))
	);
	/** The new stint's law: its company's jurisdiction as it stands on the day it starts. */
	const law = $derived(
		entity === null || firstDay === null ? undefined : laws.on(codeOf(entity), firstDay)
	);
	const sameLaw = $derived(
		from !== null &&
			entity !== null &&
			codeOf(entity) !== undefined &&
			codeOf(entity) === codeOf(from.entity_id)
	);
	const held = $derived(
		from === null
			? null
			: ctx.query({
					employee_balance: {
						where: { employee_id: { eq: person } },
						fields: ['account'],
						limit: 1
					},
					loan_catalog_entry: {
						where: { employment_id: { eq: from.id } },
						fields: ['id', 'quantity'],
						limit: 10000
					},
					loan_catalog_entry_repayment: {
						where: { employment_id: { eq: from.id } },
						fields: ['loan_id', 'amount', 'payroll_run_id'],
						limit: 10000
					}
				})
	);
	const leaveDays = $derived(
		latestLeft(
			accountsOf(held?.current?.employee_balance.rows[0]?.account),
			'leave',
			'ANNUAL_LEAVE'
		)
	);
	const loanTotal = $derived(
		outstandingOf(
			held?.current?.loan_catalog_entry.rows ?? [],
			held?.current?.loan_catalog_entry_repayment.rows ?? []
		).reduce((sum, item) => sum + item.amount, 0)
	);
	/** What the person holds on the old stint's last day, less what the target cannot take. */
	const carried = (state: JsonObject): JsonObject => {
		const allowed = categoryValues(law);
		return Object.fromEntries(
			Object.entries(state).filter(([name, value]) => {
				// a pay group and a shift pattern are their company's
				if (name === 'pay_group_id' || name === 'shift_pattern_id')
					return entity === from?.entity_id;
				// a category the old jurisdiction used is dropped, never submitted
				const values = allowed[name];
				return (
					sameLaw || !(name in allowed) || values === undefined || values.includes(String(value))
				);
			})
		);
	};
	const baseTerms = $derived(
		from === null || lastDay === null
			? {}
			: carried(inForce(from.terms.map(jsonObject).map(termsChange), lastDay).state)
	);
	const baseParameters = $derived.by((): JsonObject => {
		if (from === null || lastDay === null) return {};
		const told = carried(
			inForce(from.parameters.map(jsonObject).map(parametersChange), lastDay).state
		);
		const schema = law?.settings.employee_extension_schema;
		if (sameLaw || schema == null || !is_json_schema(schema)) return told;
		// the person's parameters from their latest stint under the target law; another jurisdiction's never carry over
		const prior = read.stints.find(
			(stint) => stint.id !== from.id && codeOf(stint.entity_id) === codeOf(entity)
		);
		const rest = Object.fromEntries(Object.entries(told).filter(([name]) => name !== 'parameters'));
		const known =
			prior === undefined
				? undefined
				: inForce(prior.parameters.map(jsonObject).map(parametersChange), lastDay).state.parameters;
		return known == null ? rest : { ...rest, parameters: known };
	});
	const terms = $derived(termsEdit ?? baseTerms);
	const parameters = $derived(parametersEdit ?? baseParameters);
	const valid = $derived(
		entity !== null &&
			firstDay !== null &&
			law !== undefined &&
			(from === null || (lastDay !== null && lastDay >= from.effective_range.from))
	);
	const title = $derived(
		from !== null
			? t('contract.transfer')
			: read.stints.length > 0
				? t('person.rehire')
				: t('person.hire')
	);

	function chooseEntity(next: Id<'entity'> | null) {
		entity = next;
		termsEdit = null;
		parametersEdit = null;
	}
	async function commit() {
		const target = law;
		if (!valid || saving || entity === null || firstDay === null || target === undefined) return;
		saving = true;
		failure = null;
		try {
			// a stint that starts in a paid period amends it: HR is asked first, as on an entry
			if (paid.covers(firstDay, entity) && !(await run(confirm_action(PAID_QUESTION)))) return;
			const told = jsonObject(parameters);
			const loans =
				from === null || lastDay === null
					? null
					: await transferOrSettleLoans(
							ctx,
							{
								id: from.id,
								entity_id: from.entity_id,
								employee_id: person,
								employee_number: from.employee_number
							},
							{ entityId: entity, law: target },
							lastDay,
							sameLaw,
							settleLoans
						);
			const acts: Record<string, Json> = {
				...loans?.writes,
				...(from === null || lastDay === null
					? {}
					: {
							'employment.update': [
								{
									target: { id: from.id, revision: from.revision },
									set: {
										effective_range: { from: from.effective_range.from, to: lastDay },
										reason: `${t('contract.transfer')}${note.trim() === '' ? '' : ` · ${note.trim()}`}`
									}
								}
							]
						}),
				'employment.create': [
					jsonObject({
						employee_id: person,
						entity_id: entity,
						effective_range: { from: firstDay, to: null },
						...(from === null
							? serviceStart === null
								? {}
								: { service_started_on: serviceStart }
							: {
									// credited service and the dated events move with the person inside one jurisdiction
									...(sameLaw && from.service_started_on != null
										? { service_started_on: from.service_started_on }
										: {}),
									...(sameLaw && from.events != null ? { events: from.events } : {})
								}),
						terms: [{ ...jsonObject(terms), effective_from: firstDay }],
						...(Object.keys(told).length === 0
							? {}
							: { parameters: [{ ...told, effective_from: firstDay }] })
					})
				]
			};
			const outcome = await run(ctx.act(acts));
			notify_outcome(ctx, outcome);
			if (outcome.kind !== 'committed') return;
			const created = outcome.records.flatMap((row) =>
				row.model === 'employment' && row.id !== from?.id ? [row.id] : []
			)[0];
			if (loans !== null && created !== undefined) await loans.follow(created);
			onclose();
		} catch (error) {
			failure = error instanceof Error ? error.message : t('component.error');
			toast.error(failure);
		} finally {
			saving = false;
		}
	}
</script>

<Sheet open on_open_change={(open) => !open && !saving && onclose()} {title}>
	<Stack gap="md">
		{#if failure !== null}<p class="text-sm text-destructive">{failure}</p>{/if}
		{#if from !== null}
			<p class="text-sm text-muted-foreground">{t('contract.change_help')}</p>
			<Stack gap="xs">
				<Label for="stint-month">{t('contract.takes_effect')}</Label>
				<Combobox
					id="stint-month"
					options={months}
					value={firstDay}
					disabled={saving}
					on_change={(next) => (firstDay = next)}
				/>
				{#if !valid && lastDay !== null && lastDay < from.effective_range.from}
					<p class="text-xs text-destructive">{t('contract.last_day_invalid')}</p>
				{/if}
			</Stack>
		{/if}
		<Stack gap="xs">
			<Label for="stint-entity"
				>{from === null ? t('person.company') : t('contract.target_entity')}</Label
			>
			<Combobox
				id="stint-entity"
				options={read.companies.map((row) => ({ value: row.id, label: row.name }))}
				value={entity}
				disabled={saving}
				on_change={chooseEntity}
			/>
		</Stack>
		{#if from === null}
			<Stack gap="xs">
				<Label for="stint-first-day">{t('person.first_day')}</Label>
				<Editor
					{ctx}
					id="stint-first-day"
					name="first_day"
					kind={{ kind: 'date' }}
					value={firstDay}
					disabled={saving}
					on_change={(next) => (firstDay = next == null ? null : String(next))}
				/>
			</Stack>
			<Stack gap="xs">
				<Label for="stint-service-start">{t('person.service_started_on')}</Label>
				<Editor
					{ctx}
					id="stint-service-start"
					name="service_started_on"
					kind={{ kind: 'date', optional: true }}
					value={serviceStart}
					disabled={saving}
					on_change={(next) => (serviceStart = next == null ? null : String(next))}
				/>
			</Stack>
		{/if}
		{#if entity !== null}
			<Stack gap="xs">
				<span class="text-sm font-medium">{t('models.contract_terms.label')}</span>
				<ContractTermsEditor
					{ctx}
					{law}
					field={{
						id: 'stint-terms',
						name: 'terms',
						kind: datedKind(ctx, 'contract_terms'),
						value: terms,
						disabled: saving,
						on_change: (next) => (termsEdit = next)
					}}
				/>
			</Stack>
			<Stack gap="xs">
				<span class="text-sm font-medium">{t('models.statutory_parameters.label')}</span>
				<ContractTermsEditor
					{ctx}
					{law}
					field={{
						id: 'stint-parameters',
						name: 'parameters',
						kind: datedKind(ctx, 'statutory_parameters'),
						value: parameters,
						disabled: saving,
						on_change: (next) => (parametersEdit = next)
					}}
				/>
			</Stack>
		{/if}
		{#if from !== null}
			{#if loanTotal > 0 && !sameLaw}
				<Cluster gap="sm" align="center">
					<Editor
						{ctx}
						id="stint-settle-loans"
						name="settle_loans"
						kind={{ kind: 'bool' }}
						value={settleLoans}
						disabled={saving}
						on_change={(next) => (settleLoans = next === true)}
					/>
					<Label for="stint-settle-loans">{t('contract.settle_loan')}</Label>
				</Cluster>
			{/if}
			<Stack gap="xs">
				<Label for="stint-note">{t('contract.reason')}</Label>
				<Editor
					{ctx}
					id="stint-note"
					name="reason"
					kind={{ kind: 'text' }}
					value={note}
					disabled={saving}
					on_change={(next) => (note = next == null ? '' : String(next))}
				/>
			</Stack>
			{#if entity !== null}
				<p class="text-sm text-muted-foreground">
					{sameLaw
						? t('contract.leave_carry_preview', { days: leaveDays })
						: t('contract.leave_settle_preview', { days: leaveDays })}
				</p>
				{#if loanTotal > 0}
					<p class="text-sm text-muted-foreground">
						{sameLaw
							? t('contract.loan_carry_preview', { amount: loanTotal })
							: t('contract.loan_preview', { amount: loanTotal })}
					</p>
				{/if}
			{/if}
		{/if}
		<Cluster gap="sm" justify="end">
			<Button variant="outline" disabled={saving} onclick={onclose}>{t('component.cancel')}</Button>
			<Button disabled={saving || !valid} onclick={commit}>{title}</Button>
		</Cluster>
	</Stack>
</Sheet>

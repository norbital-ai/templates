<script lang="ts">
	/**
	 * L-TPL-hr-payroll-033: one `employment_contract.update` that closes the terms in force the day before
	 * the successor starts (L-TPL-hr-payroll-036 overlap refusal lives in the collection transform).
	 */
	import { bolt } from '$bolt';
	import type { ActInput, Id } from '@norbital-ai/bolt';
	import { Button, Combobox, DateInput, Input, Label, Sheet, toast } from '@norbital-ai/ui';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import * as Predicate from 'effect/Predicate';
	import { Schema } from 'effect';
	import {
		allowancesOf,
		changeTermsSet,
		parseAmount,
		salaryOf,
		termInForceOn,
		type AllowanceDraft,
		type ContractTerm
	} from '../../payroll_engine/contract_terms.js';
	import { isJsonObject, type JsonObject } from '../../payroll_engine/foundation.js';
	import { governingVersion } from './governing_version.svelte.js';
	import { missingRequired, schemaAt, TERM_KEYS } from './input_schema.js';
	import SchemaFields from './schema_fields.svelte';
	import ContractAllowances from './contract_allowances.svelte';
	import { t } from '../i18n/t.js';
	import { todayKey } from '../format/calendar.js';
	import { liveRows } from '../state/live.svelte.js';

	let {
		id,
		companyId,
		terms,
		ended
	}: {
		id: Id<'employment_contract'>;
		companyId: Id<'entity'>;
		terms: readonly ContractTerm[];
		ended: boolean;
	} = $props();

	const current = $derived(termInForceOn(terms, todayKey()));
	let saving = $state(false);
	let sheetOpen = $state(false);
	let start = $state<string | null>(null);
	let salary = $state('');
	/** The whole term in force, edited in place: every key it holds is carried to its successor. */
	let values = $state<JsonObject>({});
	let patternId = $state<string | null>(null);
	let allowances = $state<{ code: string; amount: string; source?: Schema.Json }[]>([]);

	/** The version governing the new start day: its term schema is the form. */
	const version = governingVersion(
		() => (sheetOpen ? companyId : null),
		() => start
	);
	const termSchema = $derived(schemaAt(version.current?.employee_input_schema, 'contract_terms'));

	const patterns = liveRows(() =>
		sheetOpen
			? bolt.read('shift_pattern', {
					where: { company_id: { eq: companyId } },
					select: { id: true, code: true, name: true },
					all: true
				})
			: null
	);

	function open(): void {
		const from = current;
		if (from == null) {
			toast.error(t('offboarding.no_terms_in_force'));
			return;
		}
		const { effective_range: _range, ...held } = from;
		start = todayKey();
		salary = String(salaryOf(from)?.value ?? '');
		values = held;
		patternId = Predicate.isString(from.shift_pattern_id) ? from.shift_pattern_id : null;
		allowances = allowancesOf(from).map((line) => ({
			code: line.code,
			amount: String(line.amount),
			...(line.source === undefined ? {} : { source: line.source })
		}));
		sheetOpen = true;
	}

	async function submit(): Promise<void> {
		if (saving || start == null || start === '') return;
		const salaryAmount = parseAmount(salary);
		if (salaryAmount == null) {
			toast.error(t('offboarding.need_valid_salary'));
			return;
		}
		const allowanceLines: AllowanceDraft[] = [];
		for (const line of allowances) {
			if (line.code.trim() === '' && line.amount.trim() === '') continue;
			const amount = parseAmount(line.amount);
			if (amount == null) {
				toast.error(t('offboarding.need_valid_salary'));
				return;
			}
			allowanceLines.push({
				code: line.code,
				amount,
				source: $state.snapshot(line.source) ?? null
			});
		}
		const held = current == null ? null : salaryOf(current);
		const { shift_pattern_id: _pattern, ...rest } = $state.snapshot(values);
		const term: JsonObject = {
			...rest,
			base_salary: {
				...(isJsonObject(rest.base_salary) ? rest.base_salary : {}),
				value: salaryAmount,
				currency:
					held?.currency == null || held.currency === ''
						? (version.current?.payroll?.currency ?? '')
						: held.currency
			},
			...(patternId == null || patternId === '' ? {} : { shift_pattern_id: patternId })
		};
		const missing = missingRequired(termSchema, term);
		if (missing.length > 0) {
			toast.error(t('component.required_missing', { fields: missing.join(', ') }));
			return;
		}
		const set = changeTermsSet(terms, { start, values: term, allowances: allowanceLines });
		if (Predicate.isString(set)) {
			toast.error(set);
			return;
		}
		saving = true;
		try {
			const payload: ActInput<'employment_contract.update'> = { target: id, set };
			const outcome = await bolt.act('employment_contract.update', payload);
			if (outcome.kind === 'committed' || outcome.kind === 'pendingApproval') {
				toast.success(
					outcome.kind === 'pendingApproval'
						? t('offboarding.terms_pending')
						: t('offboarding.terms_submitted')
				);
				sheetOpen = false;
			} else {
				toast.error(
					outcome.kind === 'refused'
						? (outcome.message ?? t('component.error'))
						: t('component.error')
				);
			}
		} catch {
			toast.error(t('component.error'));
		} finally {
			saving = false;
		}
	}
</script>

{#if !ended && current}
	<Button size="sm" variant="outline" disabled={saving} onclick={open}
		>{t('offboarding.change_terms')}</Button
	>

	<Sheet bind:open={sheetOpen} title={t('offboarding.change_terms_title')}>
		<Stack gap="md">
			<p class="text-sm text-muted-foreground">{t('offboarding.change_terms_description')}</p>
			<Stack gap="xs">
				<Label for="terms-start">{t('offboarding.new_start')}</Label>
				<DateInput
					id="terms-start"
					of="date"
					value={start}
					onChange={(next) => (start = next)}
					disabled={saving}
				/>
			</Stack>
			<Stack gap="xs">
				<Label for="terms-salary">{t('component.base_salary')}</Label>
				<Input
					id="terms-salary"
					type="number"
					value={salary}
					disabled={saving}
					onchange={(event: Event & { currentTarget: HTMLInputElement }) =>
						(salary = event.currentTarget.value)}
				/>
			</Stack>
			{#if start != null && start !== '' && version.current == null && !version.loading}
				<p class="text-sm text-destructive">{t('component.no_governing_version')}</p>
			{/if}
			<SchemaFields
				node={termSchema}
				value={values}
				onChange={(next) => (values = next)}
				skip={TERM_KEYS}
				id="terms-term"
				disabled={saving}
			/>
			{#if (patterns.current ?? []).length > 0}
				<Stack gap="xs">
					<Label for="terms-pattern">{t('component.shift_pattern')}</Label>
					<Combobox
						id="terms-pattern"
						class="w-full"
						options={(patterns.current ?? []).map((row) => ({
							value: row.id,
							label: row.name ?? row.code ?? row.id
						}))}
						value={patternId}
						disabled={saving}
						onChange={(next) => (patternId = next)}
					/>
				</Stack>
			{/if}
			<ContractAllowances bind:lines={allowances} disabled={saving} />
			<Cluster gap="sm" justify="end">
				<Button variant="outline" disabled={saving} onclick={() => (sheetOpen = false)}>
					{t('component.cancel')}
				</Button>
				<Button
					disabled={saving ||
						start == null ||
						start === '' ||
						salary === '' ||
						version.current == null}
					onclick={() => void submit()}
				>
					{t('offboarding.save_terms')}
				</Button>
			</Cluster>
		</Stack>
	</Sheet>
{/if}

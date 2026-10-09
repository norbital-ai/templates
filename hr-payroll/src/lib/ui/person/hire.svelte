<script lang="ts">
	/** L-TPL-hr-payroll-032: create a contract with its first open terms on `facts.contract_terms`. */
	import { bolt } from '$bolt';
	import type { ActInput, Id } from '@norbital-ai/bolt';
	import {
		Button,
		Combobox,
		DateInput,
		Input,
		Label,
		openRecord,
		Sheet,
		toast
	} from '@norbital-ai/ui';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import * as Predicate from 'effect/Predicate';
	import {
		hireContractSet,
		parseAmount,
		type AllowanceDraft
	} from '../../payroll_engine/contract_terms.js';
	import type { JsonObject } from '../../payroll_engine/foundation.js';
	import { governingVersion } from './governing_version.svelte.js';
	import { missingRequired, schemaAt, TERM_KEYS } from './input_schema.js';
	import SchemaFields from './schema_fields.svelte';
	import ContractAllowances from './contract_allowances.svelte';
	import { t } from '../i18n/t.js';
	import { todayKey } from '../format/calendar.js';
	import { liveRows } from '../state/live.svelte.js';

	let {
		employeeId,
		name
	}: {
		employeeId: Id<'employment_profile'>;
		name: string;
	} = $props();

	let saving = $state(false);
	let sheetOpen = $state(false);
	let employeeNumber = $state('');
	let companyId = $state<Id<'entity'> | null>(null);
	let start = $state<string | null>(null);
	let salary = $state('');
	let values = $state<JsonObject>({});
	let patternId = $state<string | null>(null);
	let allowances = $state<{ code: string; amount: string }[]>([]);
	/** The payment account the bank file pays (`employment_contract.bank`, as the export reads it). */
	const BANK_FIELDS = [
		'bank_name',
		'bank_code',
		'bank_account_number',
		'bank_account_name'
	] as const;
	let bank = $state<Record<(typeof BANK_FIELDS)[number], string>>({
		bank_name: '',
		bank_code: '',
		bank_account_number: '',
		bank_account_name: ''
	});

	const entities = liveRows(() =>
		sheetOpen ? bolt.read('entity', { select: { id: true, name: true }, all: true }) : null
	);
	/** The version governing the start day: its term schema is the form, its payroll currency the salary's. */
	const version = governingVersion(
		() => (sheetOpen ? companyId : null),
		() => start
	);
	const termSchema = $derived(schemaAt(version.current?.employee_input_schema, 'contract_terms'));
	const currency = $derived(version.current?.payroll?.currency ?? '');
	const patterns = liveRows(() =>
		sheetOpen && companyId != null
			? bolt.read('shift_pattern', {
					where: { company_id: { eq: companyId } },
					select: { id: true, code: true, name: true },
					all: true
				})
			: null
	);

	function open(): void {
		employeeNumber = '';
		companyId = null;
		start = todayKey();
		salary = '';
		values = {};
		patternId = null;
		allowances = [];
		bank = { bank_name: '', bank_code: '', bank_account_number: '', bank_account_name: '' };
		sheetOpen = true;
	}

	async function submit(): Promise<void> {
		if (saving || companyId == null || start == null || start === '') return;
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
			allowanceLines.push({ code: line.code, amount });
		}
		const term: JsonObject = {
			...$state.snapshot(values),
			...(currency === '' ? {} : { currency }),
			base_salary: { value: salaryAmount, currency },
			...(patternId == null || patternId === '' ? {} : { shift_pattern_id: patternId })
		};
		const missing = missingRequired(termSchema, term);
		if (missing.length > 0) {
			toast.error(t('component.required_missing', { fields: missing.join(', ') }));
			return;
		}
		const set = hireContractSet({
			employee_id: employeeId,
			company_id: companyId,
			employee_number: employeeNumber,
			start,
			values: term,
			allowances: allowanceLines
		});
		if (Predicate.isString(set)) {
			toast.error(set);
			return;
		}
		saving = true;
		try {
			const payload: ActInput<'employment_contract.create'> = {
				employee_id: employeeId,
				company_id: companyId,
				employee_number: set.employee_number,
				effective_range: set.effective_range,
				facts: set.facts,
				// the account is recorded whole or not at all: the bank file needs every field
				...(BANK_FIELDS.every((field) => bank[field].trim() !== '')
					? {
							bank: {
								bank_name: bank.bank_name.trim(),
								bank_code: bank.bank_code.trim(),
								bank_account_number: bank.bank_account_number.trim(),
								bank_account_name: bank.bank_account_name.trim()
							}
						}
					: {})
			};
			const outcome = await bolt.act('employment_contract.create', payload);
			if (outcome.kind === 'committed' || outcome.kind === 'pendingApproval') {
				toast.success(
					outcome.kind === 'pendingApproval' ? t('offboarding.pending') : t('component.hire')
				);
				const created = outcome.records.find((row) => row.collection === 'employment_contract');
				if (created) openRecord('employment_contract', created.id);
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

<Button size="sm" variant="outline" disabled={saving} onclick={open}>{t('component.hire')}</Button>

<Sheet bind:open={sheetOpen} title={t('component.hire_title', { name })}>
	<Stack gap="md">
		<p class="text-sm text-muted-foreground">{t('component.hire_description')}</p>
		<Stack gap="xs">
			<Label for="hire-number">{t('component.employee_number')}</Label>
			<Input
				id="hire-number"
				value={employeeNumber}
				disabled={saving}
				onchange={(event: Event & { currentTarget: HTMLInputElement }) =>
					(employeeNumber = event.currentTarget.value)}
			/>
		</Stack>
		<Stack gap="xs">
			<Label for="hire-company">{t('component.legal_entity')}</Label>
			<Combobox
				id="hire-company"
				class="w-full"
				options={(entities.current ?? []).map((row) => ({
					value: row.id,
					label: row.name ?? row.id
				}))}
				value={companyId}
				disabled={saving}
				onChange={(next) => {
					companyId = next;
					patternId = null;
					values = {};
				}}
			/>
		</Stack>
		<Stack gap="xs">
			<Label for="hire-start">{t('offboarding.new_start')}</Label>
			<DateInput
				id="hire-start"
				of="date"
				value={start}
				onChange={(next) => (start = next)}
				disabled={saving}
			/>
		</Stack>
		<Stack gap="xs">
			<Label for="hire-salary">{t('component.base_salary')}</Label>
			<Input
				id="hire-salary"
				type="number"
				value={salary}
				disabled={saving}
				onchange={(event: Event & { currentTarget: HTMLInputElement }) =>
					(salary = event.currentTarget.value)}
			/>
		</Stack>
		{#if companyId != null && start != null && version.current == null && !version.loading}
			<p class="text-sm text-destructive">{t('component.no_governing_version')}</p>
		{/if}
		<SchemaFields
			node={termSchema}
			value={values}
			onChange={(next) => (values = next)}
			skip={TERM_KEYS}
			id="hire-term"
			disabled={saving}
		/>
		{#if (patterns.current ?? []).length > 0}
			<Stack gap="xs">
				<Label for="hire-pattern">{t('component.shift_pattern')}</Label>
				<Combobox
					id="hire-pattern"
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
		{#each BANK_FIELDS as field (field)}
			<Stack gap="xs">
				<Label for={`hire-${field}`}>{t(`component.${field}`)}</Label>
				<Input
					id={`hire-${field}`}
					value={bank[field]}
					disabled={saving}
					onchange={(event: Event & { currentTarget: HTMLInputElement }) =>
						(bank = { ...bank, [field]: event.currentTarget.value })}
				/>
			</Stack>
		{/each}
		<Cluster gap="sm" justify="end">
			<Button variant="outline" disabled={saving} onclick={() => (sheetOpen = false)}>
				{t('component.cancel')}
			</Button>
			<Button
				disabled={saving ||
					companyId == null ||
					start == null ||
					start === '' ||
					salary === '' ||
					version.current == null}
				onclick={() => void submit()}
			>
				{t('component.hire')}
			</Button>
		</Cluster>
	</Stack>
</Sheet>

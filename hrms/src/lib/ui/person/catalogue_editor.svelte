<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Combobox, use_form, type FieldEditor } from '@norbital-ai/ui';
	import { isJsonObject, type JsonObject } from '../../foundation.js';
	import {
		accountsOf,
		latestLeft
	} from '../../../data/model/employee_profile/employee_balance/service/core.js';
	import { idOf } from '../../reads.js';
	import { pageLaws } from '../law.svelte.js';
	let {
		ctx,
		family,
		field
	}: {
		ctx: PageContext;
		family: 'leave_catalog' | 'claim_catalog' | 'adhoc_catalog' | 'loan_catalog';
		field: FieldEditor;
	} = $props();
	const form = use_form();
	const selected = $derived(form?.get('catalog_code'));
	const catalogCode = $derived(typeof selected === 'string' ? selected : null);
	const companyId = $derived(form?.get('entity_id'));
	const employmentId = $derived(form?.get('employment_id'));
	const incurredOn = $derived(form?.get('incurred_on'));
	// a claim is offered against what the person's balance holds for it: their stint, then their one balance
	const stint = $derived(
		family !== 'claim_catalog' || typeof employmentId !== 'string'
			? null
			: ctx.query({
					employment: {
						where: { id: { eq: idOf('employment', employmentId) } },
						fields: ['employee_id'],
						limit: 1
					}
				})
	);
	const who = $derived(stint?.current?.employment.rows[0]?.employee_id);
	const balance = $derived(
		who == null
			? null
			: ctx.query({
					employee_balance: { where: { employee_id: { eq: who } }, fields: ['account'], limit: 1 }
				})
	);
	const accounts = $derived(accountsOf(balance?.current?.employee_balance.rows[0]?.account ?? {}));
	const company = $derived(
		typeof companyId === 'string'
			? ctx.query({
					entity: {
						output: 'self_service',
						where: { id: { eq: idOf('entity', companyId) } },
						fields: ['settings_code'],
						limit: 1
					}
				})
			: null
	);
	const code = $derived(company?.current?.entity.rows[0]?.settings_code);
	const laws = pageLaws(ctx, () => (code === undefined ? [] : [code]));
	const day = $derived(
		typeof incurredOn === 'string' ? incurredOn : String(ctx.clock('day').today)
	);
	/** What the person has left of a capped claim row, from their balance; `null` where the law sets no cap. */
	const leftFor = (row: JsonObject) =>
		isJsonObject(row.lookup) && row.lookup.annual_limit != null
			? latestLeft(accounts, 'claim', String(row.code))
			: null;
	// the rows of the company's law in force on the entry's date; a capped claim with nothing left is not offered
	const choices = $derived(
		(laws.on(code, day)?.rows[family] ?? []).filter((row) => {
			const left = family === 'claim_catalog' ? leftFor(row) : null;
			return left === null || left > 0;
		})
	);
	const amount = (value: number) => new Intl.NumberFormat(ctx.locale).format(value);
</script>

<Combobox
	id={field.id}
	disabled={field.disabled}
	value={catalogCode}
	options={choices.map((row) => ({
		value: String(row.code),
		label: typeof row.description === 'string' ? row.description : String(row.code),
		description: String(row.code),
		...(family === 'claim_catalog' && leftFor(row) !== null
			? { suffix: ctx.t('claim.left', { amount: amount(leftFor(row) ?? 0) }) }
			: {})
	}))}
	on_change={(value) => field.on_change(value)}
/>

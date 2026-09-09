<script lang="ts">
	/**
	 * The type picker's predicate for one person: the page's in-force clause, narrowed to the
	 * catalogue rows whose `eligibility` holds for them today.
	 *
	 * One query reads the employment with its employee, terms and entity; one reads the candidate
	 * rows' ids and rules. The result is handed to the child as a `where`, which the form spreads
	 * into the `Field`'s `relationOptions`: the picker itself is unchanged and keeps its search and
	 * limit. With no employment chosen yet, every in-force row is offered.
	 */
	import type { Snippet } from 'svelte';
	import { client } from '../workspace-client.js';
	import { todayKey } from './calendar.js';
	import { inForceCatalogue } from './create-scope.js';
	import { eligibleTypeIds, eligibleTypeWhere, personAsOf } from '../eligible-types.js';

	type Catalogue =
		| 'claim_catalogue'
		| 'allowance_catalogue'
		| 'payment_catalogue'
		| 'loan_catalogue'
		| 'leave_catalogue';
	let {
		catalogue,
		employmentId,
		settingsCode,
		children
	}: {
		catalogue: Catalogue;
		employmentId: string | undefined;
		settingsCode: string | undefined;
		children: Snippet<[where: Record<string, unknown> | undefined]>;
	} = $props();

	const inForce = $derived(inForceCatalogue(`${catalogue}_settings`, settingsCode));
	const personQuery = $derived(
		employmentId == null
			? null
			: client.db.employments.findFirst({
					where: { id: { eq: employmentId } },
					columns: { hire_date: true, effective_range: true, exit_date: true, children: true },
					with: {
						employment_employee: {
							columns: {
								gender: true,
								date_of_birth: true,
								nationality: true,
								marital_status: true,
								solo_parent: true,
								race: true,
								religion: true
							}
						},
						employment_company: { columns: { region: true } },
						term_employment: {
							columns: {
								effective_range: true,
								residency_status: true,
								employment_type: true,
								work_classification: true,
								base_salary: true,
								statutory_work_category: true,
								department: true,
								payroll_group: true,
								grade: true,
								residency_since: true
							}
						}
					}
				})
	);
	// Every version, not only the one in force: the picker's own clause narrows to that, and the
	// candidates are read only while a person is chosen.
	const rows = { columns: { id: true, eligibility: true }, limit: 10_000 } as const;
	const rowsQuery = $derived.by(() => {
		if (employmentId == null) return null;
		switch (catalogue) {
			case 'claim_catalogue':
				return client.db.claim_catalogue.findMany(rows);
			case 'allowance_catalogue':
				return client.db.allowance_catalogue.findMany(rows);
			case 'payment_catalogue':
				return client.db.payment_catalogue.findMany(rows);
			case 'loan_catalogue':
				return client.db.loan_catalogue.findMany(rows);
			case 'leave_catalogue':
				return client.db.leave_catalogue.findMany(rows);
		}
	});
	/** Joined into one string so the predicate below is rebuilt only when the offer changes. */
	const offer = $derived.by(() => {
		const person = personQuery?.current;
		const candidates = rowsQuery?.current;
		if (person == null || candidates == null) return null;
		return eligibleTypeIds(candidates, personAsOf(person, todayKey())).join('\n');
	});
	const where = $derived(
		eligibleTypeWhere(inForce, offer == null ? null : offer === '' ? [] : offer.split('\n'))
	);
</script>

{@render children(where)}

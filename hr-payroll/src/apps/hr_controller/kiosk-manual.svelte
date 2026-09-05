<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { inForceOnDay } from '../../lib/effective_range.js';
	import { todayKey } from '../../lib/ui/calendar.js';

	let { ondone }: { ondone: () => void } = $props();

	let term = $state('');
	let chosenId = $state<string | null>(null);
	let working = $state(false);
	let result = $state<string | null>(null);
	let error = $state<string | null>(null);

	const peopleQuery = $derived(
		term.trim().length < 2
			? null
			: client.db.employees.findMany({
					search: { mode: 'lexical', term: term.trim() },
					columns: { id: true, name: true, email: true, face_enrollment_status: true },
					limit: 20
				})
	);
	const people = $derived(peopleQuery?.current ?? []);
	const chosen = $derived(people.find((person) => person.id === chosenId) ?? null);

	const employmentsQuery = $derived(
		chosen === null
			? null
			: client.db.employments.findMany({
					where: { employee_id: { eq: chosen.id }, approval_id: { isNull: true } },
					columns: { id: true, employee_number: true, hire_date: true, effective_range: true },
					limit: 20
				})
	);
	const employments = $derived(
		(employmentsQuery?.current ?? []).filter((row) => inForceOnDay(row.effective_range, todayKey()))
	);
	const employmentsSettled = $derived(employmentsQuery != null && !employmentsQuery.loading);
</script>

<div class="flex max-w-xl flex-col gap-2 p-4">
	<h2 class="text-lg font-bold">Manual entry</h2>
	<p>For when a face cannot be read. Every entry records this device account as its author.</p>
	<input
		class="flex-1 p-2 text-base"
		type="search"
		placeholder="Name (min 2 letters)"
		bind:value={term}
	/>
	{#if error !== null}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
	{#if peopleQuery?.error}<p role="alert" class="text-sm text-destructive">
			{peopleQuery.error.message}
		</p>{/if}
	{#if term.trim().length >= 2 && (peopleQuery?.loading ?? true) === false && people.length === 0}
		<p>No people match.</p>
	{/if}
	<ul class="m-0 flex list-none flex-col gap-1 p-0">
		{#each people as person (person.id)}
			<li>
				<button
					class:outline-2={chosenId === person.id}
					onclick={() => {
						chosenId = person.id;
						result = null;
						error = null;
					}}
				>
					{person.name}{person.email ? ` · ${person.email}` : ''}
				</button>
			</li>
		{/each}
	</ul>
	{#if employmentsQuery?.error}<p role="alert" class="text-sm text-destructive">
			{employmentsQuery.error.message}
		</p>{/if}
	{#if employmentsSettled && employments.length === 0 && employmentsQuery?.error == null}
		<p>No active employment for this person.</p>
	{/if}
	{#if employments.length > 0}
		<h3 class="font-bold">Employments</h3>
		{#each employments as employment (employment.id)}
			<div class="flex flex-wrap items-center gap-2">
				<span>{employment.employee_number}</span>
				<button
					disabled={working}
					onclick={async () => {
						working = true;
						error = null;
						try {
							const outcome = await client.invoke.kiosk_punch({
								employment_id: employment.id,
								kind: 'MANUAL',
								direction: 'in'
							});
							result =
								outcome.status === 'blocked'
									? `Refused: ${outcome.reason === 'cooldown' ? `wait ${Math.ceil((outcome.retryAfterMs ?? 0) / 1000)}s` : 'duplicate punch'}.`
									: `${outcome.status === 'in' ? 'Clocked in' : 'Clocked out'} at ${new Date(outcome.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.`;
						} catch (failure) {
							error = failure instanceof Error ? failure.message : String(failure);
						} finally {
							working = false;
						}
					}}>Clock in</button
				>
				<button
					disabled={working}
					onclick={async () => {
						working = true;
						error = null;
						try {
							const outcome = await client.invoke.kiosk_punch({
								employment_id: employment.id,
								kind: 'MANUAL',
								direction: 'out'
							});
							result =
								outcome.status === 'blocked'
									? `Refused: ${outcome.reason === 'cooldown' ? `wait ${Math.ceil((outcome.retryAfterMs ?? 0) / 1000)}s` : 'duplicate punch'}.`
									: `${outcome.status === 'in' ? 'Clocked in' : 'Clocked out'} at ${new Date(outcome.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.`;
						} catch (failure) {
							error = failure instanceof Error ? failure.message : String(failure);
						} finally {
							working = false;
						}
					}}>Clock out</button
				>
			</div>
		{/each}
	{/if}
	{#if result !== null}<p role="status" class="font-bold">{result}</p>{/if}
	<button onclick={ondone}>Back to clock</button>
</div>

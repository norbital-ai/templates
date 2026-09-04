<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { inForceOnDay } from '../../lib/effective_range.js';
	import { todayKey } from '../../lib/ui/calendar.js';

	let { ondone }: { ondone: () => void } = $props();

	let term = $state('');
	let searched = $state(false);
	let searching = $state(false);
	let people: ReadonlyArray<{
		readonly id: string;
		readonly name: string;
		readonly email: string | null;
		readonly face_enrollment_status: string;
	}> = $state([]);
	let chosenId = $state<string | null>(null);
	let employments: ReadonlyArray<{
		readonly id: string;
		readonly employee_number: string;
		readonly hire_date: string;
		readonly effective_range: {
			readonly start?: string | null;
			readonly end?: string | null;
		} | null;
	}> = $state([]);
	let working = $state(false);
	let result = $state<string | null>(null);
	let error = $state<string | null>(null);

	const search = async () => {
		if (term.trim().length < 2) return;
		searching = true;
		error = null;
		try {
			const query = client.db.employees.findMany({
				search: { mode: 'lexical', term: term.trim() },
				columns: { id: true, name: true, email: true, face_enrollment_status: true },
				limit: 20
			});
			people = await query;
			searched = true;
			chosenId = null;
			employments = [];
		} catch (failure) {
			error = failure instanceof Error ? failure.message : String(failure);
		} finally {
			searching = false;
		}
	};

	const choose = async (id: string) => {
		chosenId = id;
		result = null;
		error = null;
		try {
			const rows = await client.db.employments.findMany({
				where: { employee_id: { eq: id }, approval_id: { isNull: true } },
				columns: { id: true, employee_number: true, hire_date: true, effective_range: true },
				limit: 20
			});
			const today = todayKey();
			employments = rows.filter((row) => inForceOnDay(row.effective_range, today));
			if (employments.length === 0) error = 'No active employment for this person.';
		} catch (failure) {
			error = failure instanceof Error ? failure.message : String(failure);
		}
	};

	const punch = async (employmentId: string, direction: 'in' | 'out') => {
		working = true;
		error = null;
		try {
			const outcome = await client.invoke.kiosk_punch({
				employment_id: employmentId,
				kind: 'MANUAL',
				direction
			});
			if (outcome.status === 'blocked') {
				result = `Refused: ${outcome.reason === 'cooldown' ? `wait ${Math.ceil((outcome.retryAfterMs ?? 0) / 1000)}s` : 'duplicate punch'}.`;
			} else {
				result = `${outcome.status === 'in' ? 'Clocked in' : 'Clocked out'} at ${new Date(outcome.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.`;
			}
		} catch (failure) {
			error = failure instanceof Error ? failure.message : String(failure);
		} finally {
			working = false;
		}
	};
</script>

<div class="flex max-w-xl flex-col gap-2 p-4">
	<h2 class="text-lg font-bold">Manual entry</h2>
	<p>For when a face cannot be read. Every entry records this device account as its author.</p>
	<div class="flex flex-wrap items-center gap-2">
		<input
			class="flex-1 p-2 text-base"
			type="search"
			placeholder="Name (min 2 letters)"
			bind:value={term}
			onkeydown={(event) => {
				if (event.key === 'Enter') void search();
			}}
		/>
		<button onclick={() => void search()} disabled={searching || term.trim().length < 2}>
			{searching ? 'Searching…' : 'Search'}
		</button>
	</div>
	{#if error !== null}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
	{#if searched && people.length === 0}<p>No people match.</p>{/if}
	<ul class="m-0 flex list-none flex-col gap-1 p-0">
		{#each people as person (person.id)}
			<li>
				<button class:outline-2={chosenId === person.id} onclick={() => void choose(person.id)}>
					{person.name}{person.email ? ` · ${person.email}` : ''}
				</button>
			</li>
		{/each}
	</ul>
	{#if employments.length > 0}
		<h3 class="font-bold">Employments</h3>
		{#each employments as employment (employment.id)}
			<div class="flex flex-wrap items-center gap-2">
				<span>{employment.employee_number}</span>
				<button disabled={working} onclick={() => void punch(employment.id, 'in')}>Clock in</button>
				<button disabled={working} onclick={() => void punch(employment.id, 'out')}
					>Clock out</button
				>
			</div>
		{/each}
	{/if}
	{#if result !== null}<p role="status" class="font-bold">{result}</p>{/if}
	<button onclick={ondone}>Back to clock</button>
</div>

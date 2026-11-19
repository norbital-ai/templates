<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { Id } from '@norbital-ai/bolt';
	import { DateTime, Effect } from 'effect';
	import { onDestroy } from 'svelte';
	import { Button, Combobox, confirm_action, Field, Picker, use_form } from '@norbital-ai/ui';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import { accountsOf, eventsOf, leftOn, unlimited } from '../../ledger/core.js';
	import { isJsonObject, jsonObject, type JsonObject } from '../../payroll_engine/foundation.js';
	import { inForce } from '../../dated.js';
	import { leaveOffDay } from '../../payroll_engine/attendance.js';
	import { knownOf, leaveOff, leaveShort, leaveTaken } from '../../ledger/service.js';
	import {
		PARAMETER_FIELDS,
		PROFILE_FIELDS,
		STINT_FIELDS,
		TERM_FIELDS,
		chainOf,
		leaveDaysOf,
		startsOf,
		termsChange
	} from '../../person.js';
	import { pageLaws } from '../law.svelte.js';
	import { PAID_NOTE, paidPeriods } from '../payroll/paid_period.svelte.js';

	let {
		ctx,
		entityId,
		employmentId: initialEmployment,
		entry = null,
		catalogCode = null,
		person = false,
		locked = false
	}: {
		ctx: PageContext;
		entityId: Id<'entity'>;
		employmentId?: Id<'employment'> | null;
		/** A filed entry: its half-days change in place. One a run paid may go too: the next run carries the difference. */
		entry?: Id<'leave_catalog_entry'> | null;
		catalogCode?: string | null;
		/** Names the person the entry is for: the HR controller's view; self-service is already theirs. */
		person?: boolean;
		/** Shows a filed entry without changing it: self-service. */
		locked?: boolean;
	} = $props();

	const form = use_form();
	if (form === undefined) throw new Error('Leave days need their record form.');
	const fixedEmployment = initialEmployment != null;
	const showPerson = $derived(!fixedEmployment || person);
	// a filed entry keeps its leave type
	const editable = $derived(!locked && form.mode !== 'view');
	const paid = paidPeriods(ctx);
	const clock = ctx.clock('day');
	const today = $derived(clock.today);
	/** The first day of last year: a person who left before it is not offered. */
	const recent = $derived(`${Number(clock.today.slice(0, 4)) - 1}-01-01`);
	const chosen = $derived(form.id<'employment'>('employment_id'));
	const catalog = $derived(
		typeof form.get('catalog_code') === 'string' ? String(form.get('catalog_code')) : null
	);
	// the filed entry's half-days
	const captures = $derived(
		entry == null
			? null
			: ctx.query({
					leave_catalog_entry: {
						where: { id: { eq: entry } },
						fields: ['revision', 'catalog_code'],
						limit: 1
					},
					leave_catalog_entry_day: {
						where: { leave_entry_id: { eq: entry } },
						fields: ['id', 'revision', 'incurred_on', 'part', 'payroll_run_id'],
						order_by: { incurred_on: 'asc' },
						limit: 10000
					}
				})
	);
	let pickedMonth = $state<string | null>(null);
	const at = $derived(
		DateTime.startOf(
			DateTime.makeUnsafe(
				pickedMonth ??
					String(captures?.current?.leave_catalog_entry_day.rows[0]?.incurred_on ?? clock.today)
			),
			'month'
		)
	);
	const sealed = $derived(
		new Set(
			(captures?.current?.leave_catalog_entry_day.rows ?? [])
				.filter((row) => row.payroll_run_id != null)
				.map((row) => `${String(row.incurred_on)}:${row.part}`)
		)
	);
	const sessions = $derived.by(() => {
		const operations = form.children.leave_catalog_entry_day ?? [];
		const deleted = new Set(operations.flatMap((op) => (op.action === 'delete' ? [op.id] : [])));
		const stored = (captures?.current?.leave_catalog_entry_day.rows ?? [])
			.filter((row) => !deleted.has(row.id))
			.map((row) => ({ date: String(row.incurred_on), part: row.part }));
		return [
			...stored,
			...operations.flatMap<{ date: string; part: 'AM' | 'PM' }>((op) =>
				op.action === 'create' &&
				typeof op.values.incurred_on === 'string' &&
				(op.values.part === 'AM' || op.values.part === 'PM')
					? [{ date: op.values.incurred_on, part: op.values.part }]
					: []
			)
		];
	});
	const putDays = (days: readonly { date: string; part: 'AM' | 'PM' }[]) => {
		const existing = captures?.current?.leave_catalog_entry_day.rows ?? [];
		form.queue_children('leave_catalog_entry_day', [
			...existing
				.filter(
					(row) =>
						!days.some((day) => day.date === String(row.incurred_on) && day.part === row.part)
				)
				.map((row) => ({ action: 'delete' as const, id: row.id, revision: row.revision })),
			...days
				.filter(
					(day) =>
						!existing.some((row) => day.date === String(row.incurred_on) && day.part === row.part)
				)
				.map((day) => ({
					action: 'create' as const,
					values: { incurred_on: day.date, part: day.part }
				}))
		]);
	};

	const employments = $derived(
		ctx.query({
			employment: {
				where: { entity_id: { eq: entityId } },
				fields: [
					'employee_number',
					'employee_id',
					'entity_id',
					'effective_range',
					'service_started_on',
					'events'
				],
				order_by: { employee_number: 'asc' },
				limit: 10000,
				employee_id: {
					fields: ['name', 'cumulative_service'],
					dependants: { fields: ['relation', 'born_on'], limit: 1000 }
				},
				entity_id: { fields: ['settings_code'] },
				terms: {
					fields: [
						'employment_id',
						'effective_from',
						'normal_hours_per_day',
						'normal_days_per_week',
						'pay_group_id',
						'shift_pattern_id',
						'clears'
					],
					limit: 10000
				}
			}
		})
	);
	const contract = $derived(
		(employments.current?.employment.rows ?? []).find((row) => row.id === chosen) ?? null
	);
	// leave is taken under the law in force today, of the stint's company
	const code = $derived(contract?.entity_id?.settings_code);
	const laws = pageLaws(ctx, () => (code === undefined ? [] : [code]));
	const law = $derived(laws.on(code, String(today)));
	// everything of the person the write's checks read: their stints with dated rows, balance, leave and what it posted
	const stints = $derived.by(() => {
		const who = contract?.employee_id?.id;
		if (who == null) return null;
		const theirs = { employment_id: { is: { employee_id: { eq: who } } } };
		return ctx.query({
			employment: {
				where: { employee_id: { eq: who } },
				fields: [...STINT_FIELDS],
				limit: 1000,
				entity_id: { fields: ['settings_code'] }
			},
			contract_terms: {
				where: theirs,
				fields: ['id', 'employment_id', 'effective_from', 'clears', 'signed_on', ...TERM_FIELDS],
				limit: 10000
			},
			statutory_parameters: {
				where: theirs,
				fields: ['id', 'employment_id', 'effective_from', 'clears', ...PARAMETER_FIELDS],
				limit: 10000
			},
			employee_profile: { where: { id: { eq: who } }, fields: [...PROFILE_FIELDS], limit: 1 },
			dependant: { where: { employee_id: { eq: who } }, limit: 1000 },
			employee_balance: {
				where: { employee_id: { eq: who } },
				fields: ['employee_id', 'account', 'revision'],
				limit: 1
			},
			leave_catalog_entry: {
				where: theirs,
				limit: 10000,
				leave_catalog_entry_day: {
					fields: ['leave_entry_id', 'incurred_on', 'part', 'payroll_run_id'],
					limit: 10000
				}
			}
		});
	});
	// what their leave posted, on their one balance
	const posted = $derived.by(() => {
		const balance = stints?.current?.employee_balance.rows[0]?.id;
		return balance === undefined
			? null
			: ctx.query({
					ledger_entry: {
						where: { balance_id: { eq: balance }, source: { like: 'leave_catalog_entry:%' } },
						fields: [
							'balance_id',
							'source',
							'operation',
							'account',
							'code',
							'period',
							'measure',
							'amount',
							'unit',
							'effective_on'
						],
						limit: 10000
					}
				});
	});
	const leaveAccount = $derived(
		accountsOf(stints?.current?.employee_balance.rows[0]?.account ?? {})
	);
	const subject = $derived.by(() => {
		if (contract === null || law === undefined) return null;
		const { chain, lineage } = chainOf((stints?.current?.employment.rows ?? []).map(jsonObject));
		const own = chain.find((row) => row.id === contract.id);
		return own === undefined
			? null
			: {
					scope: law.code,
					started: startsOf(own, chain, lineage, contract.employee_id?.cumulative_service === true)
						.service_started_on,
					events: eventsOf(
						jsonObject({
							events: contract.events ?? [],
							family: contract.employee_id?.dependants ?? []
						})
					)
				};
	});
	const recordDays = $derived(
		entry == null ? 0 : (captures?.current?.leave_catalog_entry_day.rows.length ?? 0) / 2
	);
	const availableFor = (row: JsonObject) => {
		const lookup = jsonObject(row.lookup ?? {});
		if (unlimited(lookup)) return Infinity;
		const target = Array.isArray(lookup.accounts) ? lookup.accounts.find(isJsonObject) : undefined;
		const code = typeof target?.code === 'string' ? target.code : String(row.code);
		const counted = jsonObject(catalogRows.find((item) => item.code === code)?.lookup ?? lookup);
		const left =
			subject === null ? 0 : leftOn(leaveAccount, 'leave', code, counted, subject, String(today));
		// a row that counts in hours offers them as days of the agreed normal day
		const agreed = inForce((contract?.terms ?? []).map(jsonObject).map(termsChange), String(today))
			.state.normal_hours_per_day;
		const dayHours = counted.unit === 'HOUR' && typeof agreed === 'number' ? agreed : 0;
		return (
			(dayHours > 0 ? left / dayHours : left) +
			(entry != null && catalogCode === row.code ? recordDays : 0)
		);
	};
	const isNoCap = (row: JsonObject) => unlimited(jsonObject(row.lookup ?? {}));
	const catalogRows = $derived.by(() => {
		const rows = (law?.rows.leave_catalog ?? []).toSorted((one, other) =>
			String(one.code).localeCompare(String(other.code))
		);
		if (catalogCode == null || rows.some((row) => row.code === catalogCode)) return rows;
		// a filed entry keeps its own leave type, even one the law has since dropped: its row on the entry's first day
		const first = captures?.current?.leave_catalog_entry_day.rows[0]?.incurred_on;
		const own =
			first == null
				? undefined
				: laws.on(code, String(first))?.rows.leave_catalog.find((row) => row.code === catalogCode);
		return own === undefined ? rows : [...rows, own];
	});
	const catalogOptions = $derived(
		catalogRows
			.filter((row) => availableFor(row) > 0)
			.map((row) => ({
				value: String(row.code),
				label: String(row.code),
				suffix: isNoCap(row) ? '' : `${availableFor(row)} d`
			}))
	);
	const monthStart = $derived(DateTime.formatIsoDateUtc(at));
	const monthEnd = $derived(DateTime.formatIsoDateUtc(DateTime.endOf(at, 'month')));
	const dates = $derived(
		Array.from({ length: DateTime.toPartsUtc(DateTime.endOf(at, 'month')).day }, (_, day) =>
			DateTime.formatIsoDateUtc(DateTime.add(at, { days: day }))
		)
	);
	const holidays = $derived(
		ctx.query({
			holiday: {
				where: {
					entity_id: { eq: entityId },
					published_at: { is_null: false }
				},
				fields: ['date', 'name', 'published_at', 'employee_id', 'replaces', 'given_to'],
				limit: 10000
			},
			pay_group: {
				where: { entity_id: { eq: entityId } },
				fields: ['payment_schedule'],
				limit: 1000
			},
			shift_pattern: {
				where: { entity_id: { eq: entityId } },
				fields: ['pattern', 'effective_range'],
				limit: 10000
			},
			shift_definition: {
				where: { entity_id: { eq: entityId } },
				fields: ['variant'],
				limit: 10000
			}
		})
	);
	// the person's roster a month either side of the one shown, as the server reads it
	const rostered = $derived(
		chosen === null
			? null
			: ctx.query({
					roster_entry: {
						where: {
							employment_id: { eq: chosen },
							work_date: {
								gte: DateTime.formatIsoDateUtc(DateTime.add(at, { months: -1 })),
								lte: DateTime.formatIsoDateUtc(
									DateTime.add(DateTime.endOf(at, 'month'), { months: 1 })
								)
							}
						},
						fields: ['employment_id', 'work_date', 'shift_definition_id'],
						limit: 10000
					}
				})
	);
	// why no leave falls on a day: the check the server refuses with, on the rows it reads
	const own = $derived(
		contract === null || holidays.current === undefined
			? null
			: leaveDaysOf(
					{ stint: jsonObject(contract), terms: (contract.terms ?? []).map(jsonObject) },
					{
						holiday: holidays.current.holiday.rows.map(jsonObject),
						pay_group: holidays.current.pay_group.rows.map(jsonObject),
						shift_pattern: holidays.current.shift_pattern.rows.map(jsonObject),
						shift_definition: holidays.current.shift_definition.rows.map(jsonObject),
						roster_entry: (rostered?.current?.roster_entry.rows ?? []).map(jsonObject)
					}
				)
	);
	const off = (date: string) => (own === null ? undefined : leaveOffDay(date, own));
	const holidayByDate = $derived(
		new Map((holidays.current?.holiday.rows ?? []).map((row) => [String(row.date), row.name]))
	);
	// what the write's checks read, from this page's rows: the same functions judge here and there
	const known = $derived.by(() => {
		const found = stints?.current;
		// no balance row, nothing posted; one whose rows are still loading is not known yet
		if (found === undefined || holidays.current === undefined) return null;
		if (posted !== null && posted.current === undefined) return null;
		const rows = (list: readonly object[]) => list.map(jsonObject);
		return knownOf(
			{
				employment: rows(found.employment.rows),
				contract_terms: rows(found.contract_terms.rows),
				statutory_parameters: rows(found.statutory_parameters.rows),
				employee_profile: rows(found.employee_profile.rows),
				dependant: rows(found.dependant.rows),
				employee_balance: rows(found.employee_balance.rows),
				ledger_entry: rows(posted?.current?.ledger_entry.rows ?? []),
				holiday: rows(holidays.current.holiday.rows),
				pay_group: rows(holidays.current.pay_group.rows),
				shift_pattern: rows(holidays.current.shift_pattern.rows),
				shift_definition: rows(holidays.current.shift_definition.rows),
				roster_entry: rows(rostered?.current?.roster_entry.rows ?? [])
			},
			rows(found.leave_catalog_entry.rows),
			found.leave_catalog_entry.rows.flatMap((row) => rows(row.leave_catalog_entry_day ?? [])),
			laws.on
		);
	});
	// the filed entry as stored: what this change replaces
	const replaced = $derived((known?.entries ?? []).filter((row) => row.id === entry));
	const who = $derived(String(contract?.employee_id?.id));
	const taken = $derived(known === null ? new Set<string>() : leaveTaken(known, replaced));
	const occupied = (date: string, part: 'AM' | 'PM') => taken.has(`${who}/${date}/${part}`);
	// why the days chosen may not be saved, in the write's own words
	const problem = $derived.by(() => {
		if (known === null || chosen === null || catalog === null || sessions.length === 0)
			return undefined;
		const stored = replaced[0];
		const filed = new Set(
			(captures?.current?.leave_catalog_entry_day.rows ?? []).map(
				(row) => `${String(row.incurred_on)}:${row.part}`
			)
		);
		const proposed = (days: typeof sessions) =>
			jsonObject({
				...(stored ?? { entity_id: entityId, employment_id: chosen }),
				catalog_code: catalog,
				days
			});
		// only the days this change adds answer for the day they fall on: a day already filed stands
		return (
			leaveOff(known, [
				proposed(sessions.filter((row) => !filed.has(`${row.date}:${row.part}`)))
			]) ?? leaveShort(known, [proposed(sessions)], String(today), replaced)
		);
	});
	// an entry's days may run across the person's stints: any of them answers for its dates
	const employed = (date: string) =>
		(stints?.current?.employment.rows ?? []).some(
			({ effective_range: range }) =>
				String(range.from) <= date && (range.to == null || date <= String(range.to))
		);
	const chosenCatalog = $derived(catalogRows.find((row) => row.code === catalog) ?? null);
	// a row counted in calendar days takes every day; any other falls only on a day the person works
	const calendar = $derived(jsonObject(chosenCatalog?.lookup ?? {}).unit === 'CALENDAR_DAY');
	const blocked = (date: string) => !employed(date) || (!calendar && off(date) !== undefined);
	// a half-day a payroll run paid: it may still be removed, and the next run carries the difference
	const isSealed = (date: string, part: 'AM' | 'PM') => sealed.has(`${date}:${part}`);
	const selected = (date: string, part: 'AM' | 'PM') =>
		sessions.some((row) => row.date === date && row.part === part);
	const availableDays = $derived(chosenCatalog === null ? 0 : availableFor(chosenCatalog));
	const selectedDays = $derived(sessions.length / 2);
	const toggle = (date: string, part: 'AM' | 'PM') => {
		if (catalog === null || blocked(date) || occupied(date, part)) return;
		putDays(
			selected(date, part)
				? sessions.filter((row) => row.date !== date || row.part !== part)
				: [...sessions, { date, part }].sort((a, b) => a.date.localeCompare(b.date))
		);
	};
	onDestroy(
		form.add_validation(() => {
			if (!editable) return [];
			const message =
				problem ?? (sessions.length === 0 ? ctx.t('errors.leave_entry_needs_day') : undefined);
			return message === undefined ? [] : [{ field: 'leave_catalog_entry_day', message }];
		})
	);
	onDestroy(
		form.confirm_submit(() => {
			// a half-day a run paid that goes, or any half-day dated in a paid period, is a correction: the save asks first
			const existing = captures?.current?.leave_catalog_entry_day.rows ?? [];
			const kept = new Set(sessions.map((session) => `${session.date}:${session.part}`));
			const corrects =
				existing.some(
					(row) => row.payroll_run_id != null && !kept.has(`${String(row.incurred_on)}:${row.part}`)
				) ||
				sessions.some(
					(session) =>
						paid.covers(session.date) &&
						!existing.some(
							(row) => String(row.incurred_on) === session.date && row.part === session.part
						)
				);
			return corrects
				? confirm_action({
						title: 'This period is already paid',
						body: PAID_NOTE,
						confirm_label: 'Save correction'
					})
				: Effect.succeed(true);
		})
	);
	const shiftMonth = (delta: number) =>
		(pickedMonth = DateTime.formatIsoDateUtc(DateTime.add(at, { months: delta })));
	const monthLabel = $derived(
		new Intl.DateTimeFormat(ctx.locale, {
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		}).format(DateTime.toDateUtc(at))
	);
	const weekday = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
	const PARTS = ['AM', 'PM'] as const;
</script>

<Stack gap="md">
	<div class="grid gap-3 sm:grid-cols-2">
		{#if showPerson}<Stack gap="xs">
				<span class="text-xs font-medium text-muted-foreground"
					>{ctx.t('component.employment')}</span
				>
				<Picker
					{ctx}
					of="employment"
					where={{
						entity_id: { eq: entityId },
						// who is employed, and who left since the start of last year: older leavers are not offered
						effective_range: { overlaps: { from: recent, to: null } }
					}}
					value={chosen}
					disabled={fixedEmployment || !editable}
					on_change={(value) => {
						form.set('employment_id', value);
						form.set('catalog_code', null);
						putDays([]);
					}}
				/>
			</Stack>{/if}
		<Stack gap="xs" class={showPerson ? 'relative' : 'relative sm:col-span-2'}>
			<span class="text-xs font-medium text-muted-foreground">{ctx.t('component.catalog')}</span>
			<Combobox
				options={catalogOptions}
				value={catalog}
				placeholder={ctx.t('component.select_leave_type')}
				aria-label={ctx.t('component.leave_type')}
				disabled={!editable}
				on_change={(value) => form.set('catalog_code', value)}
			/>
			{#if chosenCatalog !== null && !isNoCap(chosenCatalog)}<span
					class="pointer-events-none absolute top-6 right-9 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground"
					>{ctx.t('component.days_left', { count: availableDays })}</span
				>{/if}
		</Stack>
	</div>

	{#if editable}<p class="text-xs text-muted-foreground">
			{ctx.t('component.half_day_hint')}
		</p>{/if}
	<div class="rounded-xl border">
		<Cluster justify="between" class="border-b px-3 py-2">
			<Button variant="ghost" onclick={() => shiftMonth(-1)}>‹</Button>
			<span class="text-sm font-medium">{monthLabel}</span>
			<Button variant="ghost" onclick={() => shiftMonth(1)}>›</Button>
		</Cluster>
		<div
			class="grid grid-cols-7 border-b bg-muted/40 text-center text-[10px] font-medium text-muted-foreground"
		>
			{#each weekday as day, index (index)}<span class="py-1">{day}</span>{/each}
		</div>
		<div class="grid grid-cols-7">
			{#each dates as date, index (date)}
				{@const holiday = off(date) === 'HOLIDAY' ? holidayByDate.get(date) : undefined}
				<div
					class="flex min-h-24 flex-col border-b border-r p-1 text-xs last:border-r-0"
					style:grid-column-start={index === 0
						? DateTime.toPartsUtc(DateTime.makeUnsafe(date)).weekDay + 1
						: undefined}
					class:bg-muted={off(date) !== undefined}
					class:opacity-40={blocked(date)}
					title={holiday}
				>
					<span class="block text-[10px] tabular-nums text-muted-foreground"
						>{Number(date.slice(8))}</span
					>
					<div class="mt-1 flex flex-1 gap-0.5">
						{#each PARTS as part (part)}
							<button
								type="button"
								aria-label={`${date} ${part}`}
								aria-pressed={selected(date, part)}
								disabled={!editable || catalog === null || blocked(date) || occupied(date, part)}
								class="min-h-10 flex-1 rounded-md border px-0.5 py-1 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-30 {selected(
									date,
									part
								)
									? 'border-foreground bg-foreground font-medium text-background'
									: 'border-border text-muted-foreground hover:border-foreground hover:bg-muted'}"
								title={entry != null && isSealed(date, part)
									? 'A payroll run paid this half-day. Removing it is carried by the next run.'
									: undefined}
								onclick={() => toggle(date, part)}
							>
								{part}
							</button>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	</div>

	<Cluster justify="between">
		<span
			class={problem === undefined ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}
		>
			{(editable ? problem : undefined) ??
				(editable && Number.isFinite(availableDays)
					? `${selectedDays} of ${availableDays} day(s) selected`
					: `${selectedDays} day(s)`)}
		</span>
	</Cluster>
	<Field {ctx} name="evidence_file" />
</Stack>

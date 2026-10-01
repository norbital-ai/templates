import { automation, type Id } from '@norbital-ai/bolt';
import { dateKey } from '../lib/iso-day.js';
import { governed, settingsInForce } from '../lib/jurisdiction_settings.js';
import {
	calendarOccurrences,
	DUTY_CADENCES,
	dutyTypesOf,
	instanceKey,
	materialise,
	obligationContext,
	type DutyEvent,
	type ObligationContext,
	type ObligationInput
} from '../lib/obligations/materialise.js';
import { monthBounds, periodMonth } from '../lib/payroll/run/dates.js';
import { getErrorMessage } from '../lib/refuse.js';
import { decodeNumber, plainRows } from '../lib/wire.js';
import { thirdPartyWithheld } from '../lib/payroll/loan.js';
import { caseDutyEvents } from '../lib/benefit-cases/duties.js';
import { readAll, type Reads } from '../lib/reads.js';
import { entityFactsOwed, type OwedInput } from '../lib/facts-owed.js';
import { factReminders, nextRegularRun } from '../lib/obligations/reminders.js';
import { FACT_OWED } from '../lib/obligations/materialise.js';
import { referenceCodes } from '../lib/expressions/functions/tables.js';
import { PlainDate } from '@norbital-ai/std/date';

/**
 * The obligation ledger's daily sweep. Every event a duty type can listen for that the records already hold — a
 * calendar occurrence, a hire, an exit, a finalised run, an entity fact revision — raises its instances under the
 * settings version in force on the event's day. Raising is idempotent, so the sweep is also the catch-up for any
 * writer that raises inline (the run graph, the contract write): a duty already recorded is skipped. It also keeps
 * the FACT_OWED reminders (`reminders.ts`) of every entity: one per fact its next regular run would refuse on, closed
 * once recorded.
 */
const obligation_calendar = automation({
	description:
		'Daily: raises the employer duties the settings versions declare for calendar occurrences, hires, exits, finalised payroll runs, benefit case events and entity fact revisions, with their due days and amounts, and a reminder for each declared fact the next regular run would refuse on. Duties already raised are skipped; a reminder closes once its fact is recorded; nothing else is fulfilled, waived or deleted.',
	on: { cron: '30 1 * * *' },
	output: {
		kind: 'object',
		fields: {
			raised: { kind: 'int' },
			failures: { kind: 'list', of: { kind: 'text' } }
		}
	},
	runAs: ['obligation_calendar_automation'],
	concurrency: { max: 1 }
});
export default obligation_calendar;

/** Payslips a read page takes under the 4 MiB crossing: a slip with its charges and lines runs to ~35 KB. */
const PAYSLIP_PAGE = 50;

type Facts = ObligationContext['company']['facts'];
type Version = {
	readonly id: string;
	readonly code: string;
	readonly sealed_at?: unknown;
	readonly voided_at?: unknown;
	readonly approval_id?: unknown;
	readonly effective_range: unknown;
	readonly duty_types?: unknown;
	readonly payroll?: { readonly currency?: string } | null;
} & NonNullable<ReturnType<OwedInput['versionOn']>>;

obligation_calendar.run(async (_input, ctx) => {
	const today = dateKey(String(ctx.today));
	const companies = plainRows<{
		id: string;
		name: string;
		risk_class?: string | null;
		settings_code: string;
		region?: string | null;
		pay_frequency: string;
		facts?: Facts | null;
		effective_range: unknown;
	}>(
		await ctx.read('companies', {
			where: { approval_id: { isNull: true } },
			select: {
				name: true,
				risk_class: true,
				settings_code: true,
				region: true,
				pay_frequency: true,
				facts: true,
				effective_range: true
			},
			all: true
		})
	);
	const codes = [...new Set(companies.map((row) => row.settings_code))];
	const versions =
		codes.length === 0
			? []
			: plainRows<Version>(
					await ctx.read('jurisdiction_settings', {
						where: {
							code: { in: codes },
							sealed_at: { isNull: false },
							voided_at: { isNull: true },
							approval_id: { isNull: true }
						},
						select: {
							code: true,
							sealed_at: true,
							voided_at: true,
							effective_range: true,
							duty_types: true,
							payroll: true,
							facts: true,
							terms_facts: true,
							person_facts: true,
							tables: true,
							work_rules: true
						},
						all: true
					})
				);
	const reminders = await factReminderSweep(ctx, companies, versions, today);
	const settle = async (inputs: readonly ObligationInput[], failures: readonly string[]) => {
		const raised = [...inputs, ...reminders.raise];
		if (raised.length > 0) await ctx.act('obligation_instances.create', raised as never);
		for (const id of reminders.close)
			await ctx.act('obligation_instances.update', {
				target: id,
				set: { state: 'FULFILLED', fulfilled_on: PlainDate(today) }
			} as never);
		await ctx.progress({
			ratio: 1,
			text: `Duties raised: ${raised.length}. Reminders closed: ${reminders.close.length}. Failures: ${failures.length + reminders.failures.length}.`
		});
		return { raised: raised.length, failures: [...failures, ...reminders.failures] };
	};
	const declaring = new Set(
		versions.filter((version) => dutyTypesOf(version).length > 0).map((version) => version.code)
	);
	const active = companies.filter((company) => declaring.has(company.settings_code));
	if (active.length === 0) return settle([], []);
	// The active companies by their lineage, not an id list: a list is capped at 1000 items.
	const onActive = {
		is: { settings_code: { in: [...declaring] }, approval_id: { isNull: true } }
	} as never;
	const onCompanies = { employment_id: { is: { company_id: onActive } } };
	const [employments, runs, revisions, recorded, loanRows, repaymentRows, caseRows] =
		await Promise.all([
			ctx.read('employments', {
				where: { company_id: onActive, approval_id: { isNull: true } },
				select: { company_id: true, effective_range: true, exit_ground: true, exit_facts: true },
				all: true
			}),
			ctx.read('payroll_runs', {
				where: { company_id: onActive, approval_id: { isNull: true } },
				select: {
					company_id: true,
					period: true,
					pay_date: true,
					pay_due_date: true,
					kind: true,
					sequence: true,
					company_remittances: true
				},
				all: true
			}),
			ctx.read('company_facts', {
				where: { company_id: onActive, approval_id: { isNull: true } },
				select: { company_id: true, facts: true, effective_range: true },
				all: true
			}),
			ctx.read('obligation_instances', {
				where: { company_id: onActive },
				select: { duty_code: true, subject_kind: true, subject_id: true, trigger_ref: true },
				all: true
			}),
			ctx.read('loans', {
				where: { ...onCompanies, approval_id: { isNull: true } },
				select: { creditor: true },
				all: true
			}),
			ctx.read('loan_repayments', {
				where: { loan_id: { is: onCompanies } },
				select: { loan_id: true },
				all: true
			}),
			ctx.read('benefit_cases', {
				where: { ...onCompanies, approval_id: { isNull: true } },
				select: {
					employment_id: true,
					case_type: true,
					application_on: true,
					event_on: true,
					awarded_on: true,
					facts: true
				},
				all: true
			})
		]);
	const loans = plainRows<{ id: Id<'loans'>; creditor: 'EMPLOYER' | 'THIRD_PARTY' }>(loanRows);
	const repayments = plainRows<{ id: Id<'loan_repayments'>; loan_id: Id<'loans'> }>(repaymentRows);
	const cases = plainRows<{
		id: string;
		employment_id: string;
		case_type: string;
		application_on?: string | null;
		event_on?: string | null;
		awarded_on?: string | null;
		facts?: Readonly<Record<string, unknown>> | null;
	}>(caseRows);
	const existing = new Set(
		plainRows<Parameters<typeof instanceKey>[0]>(recorded as never).map(instanceKey)
	);
	const people = plainRows<{
		id: string;
		company_id: string;
		effective_range: unknown;
		exit_ground?: string | null;
		exit_facts?: Facts | null;
	}>(employments).map((row) => ({ ...row, days: governed(row.effective_range) }));
	const runRows = plainRows<{
		id: string;
		company_id: string;
		period: string;
		pay_date: string;
		pay_due_date?: string | null;
		kind?: string | null;
		sequence?: number | null;
		company_remittances?: readonly { scheme_code: string; payable_amount: number }[] | null;
	}>(runs);
	// Only a run with a RUN_FINALISED duty not yet raised needs its slips (the sweep re-reads the
	// whole history daily). ponytail: a duty whose `when` stays false re-reads its run every day;
	// record a swept marker on the run if that grows.
	const lineageOf = new Map(active.map((company) => [company.id, company.settings_code]));
	const unraised = runRows.filter((run) => {
		const code = lineageOf.get(run.company_id);
		if (code == null) return false;
		const version = settingsInForce(
			versions.filter((row) => row.code === code),
			code,
			dateKey(run.pay_date)
		);
		return dutyTypesOf(version).some(
			(duty) =>
				duty.trigger.on === 'RUN_FINALISED' &&
				duty.subject === 'RUN' &&
				!existing.has(
					instanceKey({
						duty_code: duty.code,
						subject_kind: 'RUN',
						subject_id: run.id,
						trigger_ref: run.period
					})
				)
		);
	});
	type Slip = {
		payroll_run_id: string;
		gross: unknown;
		net: unknown;
		employer_cost: unknown;
		statutory?:
			| readonly {
					scheme_code: string;
					employee_amount: number;
					employer_amount: number;
					remittance_rounding?: string | null;
			  }[]
			| null;
		adjustments?:
			| readonly {
					family: string;
					source_id: string;
					component_code: string;
					amount: number;
			  }[]
			| null;
	};
	// Paged, and an id list is capped at 1000 items.
	const slips: Slip[] = [];
	for (let at = 0; at < unraised.length; at += 1000)
		slips.push(
			...(await readAll<Slip>(
				ctx,
				'payslips',
				{ payroll_run_id: { in: unraised.slice(at, at + 1000).map((run) => run.id) } },
				PAYSLIP_PAGE,
				{
					payroll_run_id: true,
					gross: true,
					net: true,
					employer_cost: true,
					statutory: true,
					adjustments: true
				}
			))
		);
	const slipsOf = Map.groupBy(slips, (slip) => slip.payroll_run_id);

	const inputs: ObligationInput[] = [];
	const failures: string[] = [];
	for (const company of active) {
		const lineage = versions.filter((version) => version.code === company.settings_code);
		const staff = people.filter((row) => row.company_id === company.id);
		const companyRoot = (day: string, facts?: Facts | null) => ({
			settings_code: company.settings_code,
			region: company.region ?? '',
			pay_frequency: company.pay_frequency,
			headcount: staff.filter(
				(row) =>
					row.days != null && row.days.from <= day && (row.days.to == null || day <= row.days.to)
			).length,
			facts: facts ?? company.facts ?? {}
		});
		const raise = (
			event: Omit<DutyEvent, 'context'>,
			roots: Parameters<typeof obligationContext>[0] = {}
		) => {
			try {
				const version = settingsInForce(lineage, company.settings_code, event.date);
				if (version == null) return;
				const raised = materialise({
					duties: dutyTypesOf(version),
					settingsId: version.id,
					companyId: company.id,
					currency: version.payroll?.currency,
					event: {
						...event,
						context: obligationContext({ company: companyRoot(event.date), ...roots })
					},
					existing
				});
				for (const row of raised) existing.add(instanceKey(row));
				inputs.push(...raised);
			} catch (error) {
				failures.push(`${company.id} ${event.on} ${event.ref}: ${getErrorMessage(error)}`);
			}
		};

		// calendar occurrences, from the later of the lineage's first day and the entity's
		const firsts = lineage.flatMap((version) => governed(version.effective_range)?.from ?? []);
		const opened = governed(company.effective_range)?.from ?? '';
		const earliest = [...firsts].sort()[0];
		if (earliest != null) {
			const from = opened > earliest ? opened : earliest;
			for (const every of DUTY_CADENCES)
				for (const occurrence of calendarOccurrences(every, from, today)) {
					// an occurrence the lineage opens inside is governed from the lineage's first day
					const date = occurrence.start < from ? from : occurrence.start;
					raise(
						{
							on: 'CALENDAR',
							every,
							subject: { kind: 'COMPANY', id: company.id },
							ref: occurrence.ref,
							date
						},
						{ period: { start: occurrence.start, end: occurrence.end } }
					);
				}
		}
		for (const row of staff) {
			if (row.days == null) continue;
			const employment = {
				service_start: row.days.from,
				exit_date: row.days.to ?? '',
				exit_ground: row.exit_ground ?? '',
				exit_facts: row.exit_facts ?? {}
			};
			raise(
				{
					on: 'HIRE',
					subject: { kind: 'EMPLOYMENT', id: row.id },
					ref: 'HIRE',
					date: row.days.from
				},
				{ employment }
			);
			if (row.days.to != null)
				raise(
					{
						on: 'EXIT',
						subject: { kind: 'EMPLOYMENT', id: row.id },
						ref: row.days.to,
						date: row.days.to
					},
					{ employment }
				);
		}
		for (const run of runRows.filter((row) => row.company_id === company.id)) {
			const own = slipsOf.get(run.id) ?? [];
			const sum = (pick: (slip: (typeof own)[number]) => unknown) =>
				own.reduce((total, slip) => total + (decodeNumber(pick(slip)) || 0), 0);
			// Payable per scheme: both shares of every non-zero charge, except a rounded scheme's, whose
			// employer-month payable is the run's `company_remittances` row.
			const remittances: Record<string, number> = {};
			for (const slip of own)
				for (const charge of slip.statutory ?? [])
					if (
						charge.remittance_rounding == null &&
						(charge.employee_amount !== 0 || charge.employer_amount !== 0)
					)
						remittances[charge.scheme_code] =
							(remittances[charge.scheme_code] ?? 0) +
							charge.employee_amount +
							charge.employer_amount;
			for (const line of run.company_remittances ?? [])
				remittances[line.scheme_code] = (remittances[line.scheme_code] ?? 0) + line.payable_amount;
			const payDate = dateKey(run.pay_date);
			// What the run withheld for third parties under each order code (L6), across its payslips.
			const withheld: Record<string, number> = {};
			for (const slip of own)
				for (const [code, amount] of Object.entries(
					thirdPartyWithheld(
						loans,
						repayments,
						(slip.adjustments ?? []).map((row) => ({
							input: { family: row.family, id: row.source_id },
							amount: row.amount,
							catalogueComponent: { code: row.component_code }
						})) as never
					)
				))
					withheld[code] = (withheld[code] ?? 0) + amount;
			raise(
				{
					on: 'RUN_FINALISED',
					subject: { kind: 'RUN', id: run.id },
					ref: run.period,
					date: payDate
				},
				{
					period: monthBounds(periodMonth(run.period)),
					run: {
						period: run.period,
						pay_date: payDate,
						headcount: own.length,
						gross: sum((slip) => slip.gross),
						net: sum((slip) => slip.net),
						employer_cost: sum((slip) => slip.employer_cost),
						remittances,
						kind: run.kind ?? 'REGULAR',
						sequence: run.sequence ?? 1,
						pay_due_date: dateKey(run.pay_due_date),
						withheld
					}
				}
			);
		}
		// A benefit case's dated moments (application, event, award) raise its CASE duties (L5).
		const staffIds = new Set(staff.map((row) => row.id));
		for (const row of cases.filter((one) => staffIds.has(one.employment_id)))
			for (const { context, ...event } of caseDutyEvents(row))
				raise(event, { case: context.case, event: context.event });
		for (const revision of plainRows<{
			id: string;
			company_id: string;
			facts?: Facts | null;
			effective_range: unknown;
		}>(revisions)) {
			const from = governed(revision.effective_range)?.from;
			if (revision.company_id !== company.id || from == null) continue;
			raise(
				{
					on: 'FACT_CHANGE',
					subject: { kind: 'COMPANY', id: company.id },
					ref: revision.id,
					date: from
				},
				{ company: companyRoot(from, revision.facts), event: { facts: revision.facts ?? {} } }
			);
		}
	}
	return settle(inputs, failures);
});

/**
 * The FACT_OWED reminders of every entity (`reminders.ts`): the facts its next regular run would refuse on, judged as
 * the run's precheck judges them, against the reminders already recorded.
 */
async function factReminderSweep(
	ctx: Reads,
	companies: readonly {
		readonly id: string;
		readonly name: string;
		readonly settings_code: string;
		readonly region?: string | null;
		readonly risk_class?: string | null;
		readonly pay_frequency: string;
		readonly facts?: Facts | null;
		readonly effective_range: unknown;
	}[],
	versions: readonly Version[],
	today: string
) {
	const settled = { approval_id: { isNull: true } };
	const ofCompany = { company_id: { is: settled } };
	const [
		runs,
		revisions,
		employments,
		employees,
		terms,
		personFacts,
		evidence,
		references,
		recorded
	] = await Promise.all([
		readAll<{ company_id: string; period: string; kind?: string | null }>(
			ctx,
			'payroll_runs',
			{ ...settled, ...ofCompany },
			undefined,
			{ company_id: true, period: true, kind: true }
		),
		readAll<OwedInput['companyFactRevisions'][number] & { company_id: string }>(
			ctx,
			'company_facts',
			{ ...settled, ...ofCompany },
			undefined,
			{ company_id: true, facts: true, effective_range: true }
		),
		readAll<OwedInput['employments'][number] & { company_id: string }>(
			ctx,
			'employments',
			{ ...settled, ...ofCompany },
			undefined,
			{
				company_id: true,
				employee_id: true,
				employee_number: true,
				effective_range: true,
				exit_ground: true
			}
		),
		readAll<OwedInput['employees'][number]>(ctx, 'employees', settled),
		readAll<OwedInput['terms'][number]>(ctx, 'employment_terms', {
			...settled,
			employment_id: { is: ofCompany }
		}),
		readAll<OwedInput['personFacts'][number]>(ctx, 'person_facts', settled),
		readAll<{ fact_key: string; subject: { collection: string; id: string } }>(
			ctx,
			'fact_evidence',
			{},
			undefined,
			{ fact_key: true, subject: true }
		),
		readAll<Parameters<typeof referenceCodes>[0][number] & { settings_id: string }>(
			ctx,
			'reference_rows',
			{ ...settled, settings_id: { in: versions.map((version) => version.id) } },
			undefined,
			{ settings_id: true, table: true, code: true, parent_code: true, effective_range: true }
		),
		readAll<Parameters<typeof factReminders>[0]['reminders'][number] & { company_id: string }>(
			ctx,
			'obligation_instances',
			{ duty_code: { eq: FACT_OWED } },
			undefined,
			{
				company_id: true,
				state: true,
				duty_code: true,
				subject_kind: true,
				subject_id: true,
				trigger_ref: true
			}
		)
	]);
	const evidenced = new Set(
		evidence.map((row) => `${row.subject.collection}:${row.subject.id}:${row.fact_key}`)
	);
	const byVersion = Map.groupBy(references, (row) => row.settings_id);
	const raise: ObligationInput[] = [];
	const close: string[] = [];
	const failures: string[] = [];
	for (const company of companies) {
		const days = governed(company.effective_range);
		if (days == null || (days.to != null && days.to < today)) continue;
		try {
			const lineage = versions.filter((version) => version.code === company.settings_code);
			const versionOn = (day: string) => settingsInForce(lineage, company.settings_code, day);
			const next = nextRegularRun(
				runs
					.filter((run) => run.company_id === company.id && (run.kind ?? 'REGULAR') === 'REGULAR')
					.map((run) => run.period),
				company.pay_frequency,
				today
			);
			const governing = versionOn(next.window.end);
			if (governing == null) continue;
			const staff = employments.filter((row) => row.company_id === company.id);
			const owed = entityFactsOwed({
				asOf: next.window.end,
				window: next.window,
				versionOn,
				company: { ...company, region: company.region ?? null },
				companyFactRevisions: revisions.filter((row) => row.company_id === company.id),
				employments: staff,
				employees,
				terms: terms.filter((row) => staff.some((one) => one.id === row.employment_id)),
				personFacts,
				evidence: evidenced,
				codesOn: (day) => referenceCodes(byVersion.get(versionOn(day)?.id ?? '') ?? [], day)
			});
			const own = factReminders({
				companyId: company.id,
				settingsId: governing.id,
				dueOn: next.payDate,
				today,
				owed,
				reminders: recorded.filter((row) => row.company_id === company.id)
			});
			raise.push(...own.raise);
			close.push(...own.close);
		} catch (error) {
			failures.push(`${company.id} ${FACT_OWED}: ${getErrorMessage(error)}`);
		}
	}
	return { raise, close, failures };
}

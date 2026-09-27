// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import { memoryCtx, memoryDb, runTransform } from './ctx.ts';

/**
 * The rows the `work_days` transform reads, in memory: every employment belongs to `co-1`, whose lineage `TEST` has one
 * sealed version; the caller supplies the runs, payslips, leave, terms, codes, patterns, days and rosters the case is
 * about.
 */
export const VERSION = {
	id: 'settings-1',
	code: 'TEST',
	name: 'Test version',
	jurisdiction_code: 'TEST-JUR',
	sealed_at: '2020-01-01T00:00:00.000Z',
	voided_at: null,
	approval_id: null,
	effective_range: { from: '2020-01-01', to: null },
	payroll: { timezone: 'Asia/Kuala_Lumpur' },
	work_rules: null
};

export function workDayTables({
	runs = [],
	payslips = [],
	leave = [],
	terms = [],
	days = [],
	codes = [],
	patterns = [],
	rosters = [],
	holidays = [],
	versions = [VERSION],
	employees = ['emp-1', 'emp-2'],
	people = []
} = {}) {
	const co = (row) => ({ company_id: 'co-1', ...row });
	return {
		companies: [
			{
				id: 'co-1',
				name: 'Test Sdn Bhd',
				registration_number: 'T-1',
				settings_code: 'TEST',
				region: null,
				facts: {},
				pay_cutoff_day: 1
			}
		],
		employments: employees.map((id) =>
			co({
				id,
				employee_id: `person-${id}`,
				employee_number: id,
				effective_range: { from: '2000-01-01', to: null }
			})
		),
		employees: people,
		employment_terms: terms,
		work_days: days,
		rosters,
		shift_definitions: codes.map(co),
		shift_patterns: patterns.map(co),
		jurisdiction_settings: versions,
		payroll_runs: runs.map(co),
		payslips,
		leave_entries: leave.map((row) => ({ activity: 'TIME_OFF', approval_id: null, ...row })),
		jurisdiction_holidays: holidays
	};
}

/** One `work_days` write batch; a refusal rejects with the transform's sentence. */
export const writeDays = (collection, inputs, tables, existing) =>
	runTransform(collection, inputs, { tables, ...(existing === undefined ? {} : { existing }) });

/** One input through the transform, its payload back. */
export const writeDay = async (collection, input, existing, tables) =>
	(await writeDays(collection, [input], tables, [existing]))[0];

/**
 * An action's `ctx`: reads over the same tables, and `act` recorded instead of written (the acts of one action commit
 * as one statement; a test asserts what the body asked for). A create answers with minted ids in input order.
 */
export function actionCtx(tables, { now } = {}) {
	const acts = [];
	let minted = 0;
	const ctx = {
		...memoryCtx(tables, { ...(now === undefined ? {} : { now }) }),
		...memoryDb(tables),
		acts,
		act: async (callable, input) => {
			acts.push({ callable, input });
			const rows = Array.isArray(input) ? input : [input];
			const [collection, verb] = callable.split('.');
			return {
				kind: 'committed',
				output: undefined,
				records:
					verb === 'create'
						? rows.map(() => ({ collection, id: `${collection}-new-${++minted}`, revision: 1 }))
						: []
			};
		}
	};
	return ctx;
}

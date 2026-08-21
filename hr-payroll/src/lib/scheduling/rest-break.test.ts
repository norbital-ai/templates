// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	statutoryRegimeIssues,
	statutoryRegimeSchema
} from '../../datatypes/statutory_regime/+definition.ts';
import {
	restBreakAssessment,
	restBreakBlocksWrite,
	restBreakMessage,
	restBreakShort,
	selectRestBreakRule
} from './rest-break.ts';

/**
 * The four transcribed jurisdictions, from `seed_bank/norbital_hr/statutory/rest_break_rules.json`.
 *
 * They are copied here rather than paraphrased into convenient round numbers, because the whole
 * claim this module makes is that four differently shaped statutes fit one set of fields with no
 * branch per country. A test that invented its own tidy rule would prove that a tidy rule works.
 * Only `on_exceed` is added — it is the one field of the member that is a policy choice rather than
 * a transcription, so the seed bank has nothing to say about it.
 */
const MY_GENERAL = {
	// EA 1955 s.60A(1)(a): not more than five consecutive hours without ≥ 30 minutes of leisure.
	after_consecutive_hours: 5,
	minimum_minutes: 30,
	counts_as_worked_time: null,
	applies_when: 'ALWAYS',
	on_exceed: 'WARN',
	authority: 'Employment Act 1955 s.60A(1)(a)'
};

const MY_CONTINUOUS = {
	// EA 1955 s.60A(1) proviso (ii): eight consecutive hours inclusive of ≥ 45 minutes in aggregate.
	after_consecutive_hours: 8,
	minimum_minutes: 45,
	counts_as_worked_time: null,
	applies_when: 'CONTINUOUS_ATTENDANCE',
	on_exceed: 'WARN',
	authority: 'Employment Act 1955 s.60A(1) proviso (ii)'
};

const PH_MEAL = {
	// Labor Code art.85: sixty minutes for regular meals. No consecutive-hours trigger at all.
	after_consecutive_hours: null,
	minimum_minutes: 60,
	counts_as_worked_time: null,
	applies_when: 'ALWAYS',
	on_exceed: 'WARN',
	authority: 'Labor Code of the Philippines art.85'
};

const ID_REST = {
	// UU 13/2003 ps.79(2)(a): ≥ 30 minutes after four consecutive hours, not counted as work.
	after_consecutive_hours: 4,
	minimum_minutes: 30,
	counts_as_worked_time: false,
	applies_when: 'ALWAYS',
	on_exceed: 'WARN',
	authority: 'Undang-Undang No. 13 Tahun 2003 Pasal 79(2)(a)'
};

const SG_LEISURE = {
	// EA 1968 s.38(1)(a): a period of leisure after six consecutive hours, of no prescribed length.
	after_consecutive_hours: 6,
	minimum_minutes: null,
	counts_as_worked_time: null,
	applies_when: 'ALWAYS',
	on_exceed: 'WARN',
	authority: 'Employment Act 1968 s.38(1)(a)'
};

/** `HH:MM` on one day, in a fixed offset. The offset is irrelevant to every span measured here. */
const at = (time: string): string => `2026-08-11T${time}:00+08:00`;
const worked = (...pairs: [string, string | null][]) =>
	pairs.map(([start, end]) => ({ start_at: at(start), end_at: end === null ? null : at(end) }));

describe('Malaysia — EA 1955 s.60A(1)(a)', () => {
	it('owes thirty minutes once five consecutive hours are exceeded', () => {
		const result = restBreakAssessment({
			intervals: worked(['08:00', '18:00']),
			breakMinutes: 30,
			rules: [MY_GENERAL, MY_CONTINUOUS]
		});
		assert.equal(result.rule, MY_GENERAL);
		assert.equal(result.triggered, true);
		assert.equal(result.longestRunHours, 10);
		assert.equal(result.requiredMinutes, 30);
		assert.equal(result.takenMinutes, 30);
		assert.equal(result.shortfallMinutes, 0);
	});

	// Proviso (i): "a break of less than thirty minutes shall not be deemed to interrupt" the five
	// consecutive hours. Two four-and-a-half-hour halves either side of a twenty-minute pause are
	// therefore one nine-hour run, and the day is short.
	it('a gap shorter than the minimum does not interrupt continuity', () => {
		const result = restBreakAssessment({
			intervals: worked(['08:00', '12:00'], ['12:20', '17:00']),
			breakMinutes: 20,
			rules: [MY_GENERAL]
		});
		assert.equal(result.longestRunHours, 9);
		assert.equal(result.triggered, true);
		assert.equal(result.takenMinutes, 20);
		assert.equal(result.shortfallMinutes, 10);
	});

	it('a gap of the minimum is a break in its own right and starts the hours again', () => {
		const result = restBreakAssessment({
			intervals: worked(['08:00', '12:00'], ['12:30', '17:00']),
			breakMinutes: 0,
			rules: [MY_GENERAL]
		});
		assert.equal(result.longestRunHours, 4.5);
		assert.equal(result.triggered, false);
		// The punches prove the break even though the flat column says nothing.
		assert.equal(result.takenMinutes, 30);
		assert.equal(result.requiredMinutes, 0);
		assert.equal(result.shortfallMinutes, 0);
	});

	// The correction §4.2 asks for: this is a ten-and-a-quarter-hour split shift, and whether any of
	// it was overtime never enters the calculation.
	it('a split shift with no overtime at all still crosses the trigger', () => {
		const result = restBreakAssessment({
			intervals: worked(['06:00', '11:00'], ['11:15', '16:15']),
			breakMinutes: 15,
			rules: [MY_GENERAL]
		});
		assert.equal(result.longestRunHours, 10.25);
		assert.equal(result.shortfallMinutes, 15);
	});

	it('exactly five consecutive hours is permitted, not owed', () => {
		const result = restBreakAssessment({
			intervals: worked(['08:00', '13:00']),
			breakMinutes: 0,
			rules: [MY_GENERAL]
		});
		assert.equal(result.longestRunHours, 5);
		assert.equal(result.triggered, false);
		assert.equal(result.shortfallMinutes, 0);
		assert.equal(restBreakMessage(result, '11 Aug'), null);
	});

	it('the flat break column tops the observed gaps up when no break was punched', () => {
		const result = restBreakAssessment({
			intervals: worked(['08:00', '18:00']),
			breakMinutes: 60,
			rules: [MY_GENERAL]
		});
		assert.equal(result.takenMinutes, 60);
		assert.equal(result.shortfallMinutes, 0);
	});

	it('the message names the figures and cites the section', () => {
		const result = restBreakAssessment({
			intervals: worked(['08:00', '12:00'], ['12:20', '17:00']),
			breakMinutes: 20,
			rules: [MY_GENERAL]
		});
		const message = restBreakMessage(result, '11 Aug');
		assert.match(message, /^11 Aug: 9 consecutive hours worked with 20 minutes of break/);
		assert.match(message, /10 minutes short/);
		assert.match(message, /Employment Act 1955 s\.60A\(1\)\(a\)/);
	});
});

describe('Malaysia — the continual-attendance proviso', () => {
	it('replaces the general arm only when the work is asserted to require it', () => {
		assert.equal(selectRestBreakRule([MY_GENERAL, MY_CONTINUOUS], true), MY_CONTINUOUS);
		assert.equal(selectRestBreakRule([MY_GENERAL, MY_CONTINUOUS], false), MY_GENERAL);
		assert.equal(selectRestBreakRule([MY_GENERAL, MY_CONTINUOUS], undefined), MY_GENERAL);
	});

	// "a period or periods of not less than forty-five minutes **in the aggregate**" — under this arm
	// the pauses add up, which is exactly what proviso (i) forbids under the general arm.
	it('aggregates every gap, so two twenty-five minute pauses satisfy forty-five', () => {
		const intervals = worked(['08:00', '12:00'], ['12:25', '16:30'], ['16:55', '21:00']);
		const continuous = restBreakAssessment({
			intervals,
			breakMinutes: 0,
			rules: [MY_GENERAL, MY_CONTINUOUS],
			continuousAttendance: true
		});
		assert.equal(continuous.rule, MY_CONTINUOUS);
		assert.equal(continuous.longestRunHours, 13);
		assert.equal(continuous.takenMinutes, 50);
		assert.equal(continuous.requiredMinutes, 45);
		assert.equal(continuous.shortfallMinutes, 0);

		// The same day under the general arm: neither pause is a period of leisure at all.
		const general = restBreakAssessment({ intervals, breakMinutes: 0, rules: [MY_GENERAL] });
		assert.equal(general.takenMinutes, 0);
		assert.equal(general.shortfallMinutes, 30);
	});

	it('a jurisdiction that grants no such exception keeps its general rule', () => {
		const result = restBreakAssessment({
			intervals: worked(['09:00', '17:00']),
			breakMinutes: 0,
			rules: [PH_MEAL],
			continuousAttendance: true
		});
		assert.equal(result.rule, PH_MEAL);
	});
});

describe('Philippines — a flat duty with no trigger', () => {
	it('owes sixty minutes on any day that was worked', () => {
		const result = restBreakAssessment({
			intervals: worked(['09:00', '17:00']),
			breakMinutes: 0,
			rules: [PH_MEAL]
		});
		assert.equal(result.triggered, true);
		assert.equal(result.requiredMinutes, 60);
		assert.equal(result.shortfallMinutes, 60);
	});

	it('is satisfied by an hour off the clock', () => {
		const result = restBreakAssessment({
			intervals: worked(['09:00', '12:00'], ['13:00', '18:00']),
			breakMinutes: 0,
			rules: [PH_MEAL]
		});
		assert.equal(result.takenMinutes, 60);
		assert.equal(result.shortfallMinutes, 0);
	});

	it('owes nothing on a day nobody worked', () => {
		const result = restBreakAssessment({ intervals: [], breakMinutes: 0, rules: [PH_MEAL] });
		assert.equal(result.triggered, false);
		assert.equal(result.longestRunHours, 0);
		assert.equal(result.requiredMinutes, 0);
		assert.equal(result.shortfallMinutes, 0);
	});
});

describe('Indonesia — a rest expressly outside working hours', () => {
	it('owes thirty minutes past four consecutive hours', () => {
		const result = restBreakAssessment({
			intervals: worked(['08:00', '13:00']),
			breakMinutes: 0,
			rules: [ID_REST]
		});
		assert.equal(result.triggered, true);
		assert.equal(result.shortfallMinutes, 30);
	});

	/**
	 * The one field that could tempt a caller into pricing something, asserted to pass through
	 * untouched. The assessment reports what the statute says about the break and never converts it
	 * into an hours figure — no field of the result is a quantity payroll can consume, which is the
	 * §4.3 constraint made into a test rather than a comment.
	 */
	it('reports the statute on paid status without turning it into a quantity', () => {
		const result = restBreakAssessment({
			intervals: worked(['08:00', '13:00']),
			breakMinutes: 0,
			rules: [ID_REST]
		});
		assert.equal(result.rule.counts_as_worked_time, false);
		assert.deepEqual(Object.keys(result).toSorted(), [
			'longestRunHours',
			'open',
			'requiredMinutes',
			'rule',
			'shortfallMinutes',
			'takenMinutes',
			'triggered'
		]);
	});
});

describe('Singapore — a trigger with no stated duration', () => {
	it('never produces a shortfall, and says so rather than reporting zero', () => {
		const result = restBreakAssessment({
			intervals: worked(['08:00', '17:00']),
			breakMinutes: 45,
			rules: [SG_LEISURE]
		});
		assert.equal(result.triggered, true);
		assert.equal(result.longestRunHours, 9);
		assert.equal(result.requiredMinutes, null);
		assert.equal(result.shortfallMinutes, null);
		assert.equal(restBreakShort(result), false);
	});

	it('still says the trigger was crossed, with the citation', () => {
		const result = restBreakAssessment({
			intervals: worked(['08:00', '17:00']),
			breakMinutes: 45,
			rules: [SG_LEISURE]
		});
		const message = restBreakMessage(result, '11 Aug');
		assert.match(message, /does not put a length on/);
		assert.match(message, /Employment Act 1968 s\.38\(1\)\(a\)/);
	});

	// With no minimum prescribed, the shortest observed pause is still "a period of leisure".
	it('treats any gap as the leisure the Act asks for', () => {
		const result = restBreakAssessment({
			intervals: worked(['08:00', '13:00'], ['13:10', '18:00']),
			breakMinutes: 0,
			rules: [SG_LEISURE]
		});
		assert.equal(result.longestRunHours, 5);
		assert.equal(result.triggered, false);
		assert.equal(result.takenMinutes, 10);
	});

	it('cannot block a write, whatever on_exceed says', () => {
		const result = restBreakAssessment({
			intervals: worked(['08:00', '17:00']),
			breakMinutes: 0,
			rules: [{ ...SG_LEISURE, on_exceed: 'BLOCK' }]
		});
		assert.equal(restBreakBlocksWrite(result), false);
	});
});

describe('the absence of a rule, and days that cannot be measured', () => {
	it('a snapshot with no member states no rule, and no rule is no check', () => {
		for (const rules of [undefined, null, []]) {
			const result = restBreakAssessment({
				intervals: worked(['08:00', '20:00']),
				breakMinutes: 0,
				rules
			});
			assert.equal(result.rule, null);
			assert.equal(result.triggered, false);
			assert.equal(result.requiredMinutes, null);
			assert.equal(result.shortfallMinutes, null);
			assert.equal(restBreakMessage(result, '11 Aug'), null);
			assert.equal(restBreakBlocksWrite(result), false);
		}
	});

	it('an open clock withholds the shortfall instead of asserting one', () => {
		const result = restBreakAssessment({
			intervals: worked(['08:00', '15:00'], ['15:10', null]),
			breakMinutes: 0,
			rules: [MY_GENERAL]
		});
		assert.equal(result.open, true);
		assert.equal(result.triggered, true);
		assert.equal(result.requiredMinutes, 30);
		assert.equal(result.shortfallMinutes, null);
		assert.equal(restBreakBlocksWrite(result), false);
	});

	it('duplicate and unreadable intervals cannot invent a gap or throw', () => {
		const result = restBreakAssessment({
			intervals: [
				...worked(['08:00', '18:00'], ['08:00', '18:00']),
				{ start_at: 'not a time', end_at: 'not a time either' }
			],
			breakMinutes: 30,
			rules: [MY_GENERAL]
		});
		assert.equal(result.longestRunHours, 10);
		assert.equal(result.takenMinutes, 30);
	});

	it('a nonsense break column is read as no break rather than as NaN', () => {
		const result = restBreakAssessment({
			intervals: worked(['08:00', '18:00']),
			breakMinutes: Number.NaN,
			rules: [MY_GENERAL]
		});
		assert.equal(result.takenMinutes, 0);
		assert.equal(result.shortfallMinutes, 30);
	});
});

describe('on_exceed', () => {
	const short = (on_exceed) =>
		restBreakAssessment({
			intervals: worked(['08:00', '18:00']),
			breakMinutes: 0,
			rules: [{ ...MY_GENERAL, on_exceed }]
		});

	it('WARN reports the shortfall without refusing the write', () => {
		assert.equal(restBreakShort(short('WARN')), true);
		assert.equal(restBreakBlocksWrite(short('WARN')), false);
	});

	it('BLOCK refuses it', () => {
		assert.equal(restBreakBlocksWrite(short('BLOCK')), true);
	});

	it('a satisfied day never blocks', () => {
		const result = restBreakAssessment({
			intervals: worked(['08:00', '18:00']),
			breakMinutes: 45,
			rules: [{ ...MY_GENERAL, on_exceed: 'BLOCK' }]
		});
		assert.equal(restBreakBlocksWrite(result), false);
	});
});

describe('the snapshot member', () => {
	const REGIME = {
		overtime_coverage: null,
		overtime_rules: [],
		overtime_limits: []
	};

	const validate = (value) => statutoryRegimeSchema['~standard'].validate(value);
	const accepts = (value) => validate(value).issues === undefined;

	/**
	 * The reason the member is optional rather than required. Every jurisdiction seeded before it
	 * existed carries the three older keys and nothing else, and the standard view is strict — a
	 * required member would have failed the decode of all six of them at the first write.
	 */
	it('accepts a snapshot that predates it', () => {
		assert.ok(accepts(REGIME));
	});

	it('accepts the transcribed rules', () => {
		assert.ok(accepts({ ...REGIME, rest_break_rules: [MY_GENERAL, MY_CONTINUOUS] }));
		assert.ok(accepts({ ...REGIME, rest_break_rules: [PH_MEAL] }));
		assert.ok(accepts({ ...REGIME, rest_break_rules: [ID_REST] }));
		assert.ok(accepts({ ...REGIME, rest_break_rules: [SG_LEISURE] }));
		assert.ok(accepts({ ...REGIME, rest_break_rules: [] }));
	});

	it('refuses a rule that omits a field or invents one', () => {
		const { on_exceed: _dropped, ...withoutAction } = MY_GENERAL;
		assert.ok(!accepts({ ...REGIME, rest_break_rules: [withoutAction] }));
		assert.ok(
			!accepts({ ...REGIME, rest_break_rules: [{ ...MY_GENERAL, effective_range: null }] })
		);
		assert.ok(!accepts({ ...REGIME, rest_break_rules: [{ ...MY_GENERAL, authority: '' }] }));
		assert.ok(
			!accepts({ ...REGIME, rest_break_rules: [{ ...MY_GENERAL, applies_when: 'SOMETIMES' }] })
		);
		assert.ok(
			!accepts({ ...REGIME, rest_break_rules: [{ ...MY_GENERAL, minimum_minutes: 22.5 }] })
		);
		assert.ok(!accepts({ ...REGIME, rest_break_rules: [{ ...MY_GENERAL, minimum_minutes: 0 }] }));
	});

	it('a rule that states neither a trigger nor a minimum says nothing', () => {
		const issues = statutoryRegimeIssues(
			{
				...REGIME,
				rest_break_rules: [{ ...MY_GENERAL, after_consecutive_hours: null, minimum_minutes: null }]
			},
			'MYR'
		);
		assert.equal(issues.length, 1);
		assert.match(issues[0], /neither a consecutive-hours trigger nor a minimum/);
	});

	it('two rules cannot share one arm', () => {
		const issues = statutoryRegimeIssues(
			{ ...REGIME, rest_break_rules: [MY_GENERAL, { ...MY_GENERAL, minimum_minutes: 45 }] },
			'MYR'
		);
		assert.equal(issues.length, 1);
		assert.match(issues[0], /More than one rest break rule applies when ALWAYS/);
	});

	it('the transcribed pair raises nothing', () => {
		assert.deepEqual(
			statutoryRegimeIssues({ ...REGIME, rest_break_rules: [MY_GENERAL, MY_CONTINUOUS] }, 'MYR'),
			[]
		);
		assert.deepEqual(statutoryRegimeIssues(REGIME, 'MYR'), []);
	});
});

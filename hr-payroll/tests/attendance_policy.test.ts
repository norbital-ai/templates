/**
 * Attendance terms and month windows are rows: every seed version states them, the engine refuses a version without
 * them, and the attendance engine files grow no numeric literal that is not a named read bound.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { it } from '@effect/vitest';
import { Effect, Result, Schema } from 'effect';
import ts from 'typescript';
import { inputSchema } from '@norbital-ai/std/kind';
import settingsModel from '../src/data/model/+jurisdiction_settings.model.ts';
import {
	SUSPENSION_KINDS_SHAPE,
	type SuspensionKind
} from '../src/lib/payroll_engine/suspension_kinds.ts';
import {
	attendancePolicy,
	payrollMonths,
	type SettingsRow,
	suspendedDay
} from '../src/lib/payroll_engine/payslip/context.ts';
import { lineage, LINEAGES } from './jurisdiction_kit.ts';

const SettingsCodec = inputSchema({
	kind: 'object',
	fields: {
		code: settingsModel.fields.code,
		payroll: settingsModel.fields.payroll,
		suspension_kinds: SUSPENSION_KINDS_SHAPE
	}
});
type Settings = Pick<SettingsRow, 'code' | 'payroll'> & {
	readonly suspension_kinds: readonly SuspensionKind[];
};
const SettingsFixture = Schema.declare<Settings>((value): value is Settings =>
	Schema.is(SettingsCodec)(value)
);

it.effect(
	'every seed version states its attendance terms, month windows, monthly wage and suspension flags',
	() =>
		Effect.gen(function* () {
			for (const code of LINEAGES) {
				const law = lineage(code);
				for (const version of law.versions) {
					const settings = Schema.decodeUnknownSync(SettingsFixture)(
						Schema.decodeUnknownSync(SettingsCodec)(law.settingsOf(version))
					);
					const where = `${code}/${version}`;
					assert.ok(Result.isSuccess(attendancePolicy(settings)), where);
					assert.ok(Result.isSuccess(payrollMonths(settings, 'history_months')), where);
					assert.ok(Result.isSuccess(payrollMonths(settings, 'rolling_hours_months')), where);
					assert.ok((settings.payroll?.monthly_wage ?? '').trim() !== '', where);
					// Every seeded flag is a literal: the kind decides on any day.
					for (const kind of settings.suspension_kinds)
						yield* suspendedDay(kind, {}).pipe(
							Effect.mapError((refusal) => new Error(`${where}: ${refusal.message}`))
						);
				}
			}
		})
);

it('a version without its attendance terms or month windows is refused, naming the key', () => {
	const bare = { code: 'BARE', payroll: { currency: 'SGD' } };
	const refusal = (result: Result.Result<unknown, { readonly message: string }>) =>
		Result.isFailure(result) ? result.failure.message : '';
	assert.match(refusal(attendancePolicy(bare)), /BARE needs payroll\.attendance/);
	assert.match(
		refusal(payrollMonths(bare, 'history_months')),
		/BARE needs payroll\.history_months/
	);
	assert.match(
		refusal(payrollMonths(bare, 'rolling_hours_months')),
		/BARE needs payroll\.rolling_hours_months/
	);
	assert.equal(
		Result.getOrThrow(
			payrollMonths({ code: 'X', payroll: { rolling_hours_months: 6 } }, 'rolling_hours_months')
		),
		6
	);
});

it.effect('a suspension kind’s flags are its own CEL; a blank flag is refused', () =>
	Effect.gen(function* () {
		const day = { day: { day_type: 'WORK' } };
		assert.deepEqual(
			yield* suspendedDay(
				{ code: 'CLOSURE', counts_as_attended: 'true', scheduled: 'day.day_type == "WORK"' },
				day
			),
			{ counts_as_attended: true, scheduled: true }
		);
		const blank = yield* Effect.flip(
			suspendedDay({ code: 'CLOSURE', counts_as_attended: 'true', scheduled: ' ' }, day)
		);
		assert.match(blank.message, /suspension_kind CLOSURE needs scheduled/);
		const unknown = yield* Effect.flip(suspendedDay(undefined, day));
		assert.match(unknown.message, /needs counts_as_attended/);
	})
);

/**
 * The numeric literals the attendance engine files hold, by value: unit conversions (minutes, hours, days in
 * milliseconds), cents and percent, calendar-string offsets and clock noise. A new
 * literal fails; a named read bound (`const NAME = n` under a `ponytail:` comment) is exempt.
 */
const PINNED: Readonly<Record<string, Readonly<Record<string, number>>>> = {
	'src/lib/payroll_engine/shift_pattern.ts': {
		// 0/1/2 arithmetic; 3/5 and 2 clock-string offsets; 60 minutes; 100 hundredths; 1440 minutes a day
		'0': 8,
		'1': 2,
		'2': 2,
		'3': 1,
		'5': 1,
		'60': 2,
		'100': 2,
		'1440': 1,
		'86400000': 1,
		'1e-9': 1
	},
	'src/lib/payroll_engine/payslip/overtime.ts': {
		// 12: the float clean-up scale of counted hours
		'0': 14,
		'1': 3,
		'2': 1,
		'12': 1,
		'1e-9': 1
	},
	'src/lib/payroll_engine/payslip/context.ts': {
		// 4/5/7/10/16: date-string offsets and the decimal base; 12 months a year (year-start clamp, age in
		// years); 2048 the calendar cache bound. Month windows come from `payroll.<key>` (`payrollMonths`).
		'0': 86,
		'1': 30,
		'2': 5,
		'4': 3,
		'5': 1,
		'7': 7,
		'10': 1,
		'12': 2,
		'16': 1,
		'100': 4,
		'2048': 1,
		'60000': 1,
		'3600000': 7,
		'1e-9': 2
	}
};
const literals = (file: string): Record<string, number> => {
	const source = ts.createSourceFile(
		file,
		readFileSync(resolve(process.cwd(), file), 'utf8'),
		ts.ScriptTarget.Latest,
		true
	);
	const counts: Record<string, number> = {};
	const readBound = (node: ts.Node): boolean => {
		const statement = node.parent?.parent?.parent;
		return (
			ts.isVariableDeclaration(node.parent) &&
			statement !== undefined &&
			ts.isVariableStatement(statement) &&
			(ts.getLeadingCommentRanges(source.text, statement.getFullStart()) ?? []).some((range) =>
				source.text.slice(range.pos, range.end).includes('ponytail:')
			)
		);
	};
	const visit = (node: ts.Node): void => {
		if (ts.isNumericLiteral(node) && !readBound(node))
			counts[node.text] = (counts[node.text] ?? 0) + 1;
		ts.forEachChild(node, visit);
	};
	visit(source);
	return counts;
};

it('the attendance engine files add no numeric literal beyond their pinned units and named read bounds', () => {
	for (const [file, pinned] of Object.entries(PINNED))
		assert.deepEqual(literals(file), pinned, file);
});

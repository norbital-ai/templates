import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateLeavePreview, previewWindowOf } from '../src/lib/leave/preview.ts';
import { approve, id, leaveContext, timeOff } from './helpers/manual-leave-context.ts';

const range = {
	start: { date: '2026-04-15', half: 'FIRST' as const },
	end: { date: '2026-04-15', half: 'SECOND' as const }
};
const input = { employment_id: id(1), leave_catalogue_id: id(7), calendar_month: '2026-04', range };

test('preview uses computed entitlement without requiring a persisted annual account', () => {
	const context = leaveContext();
	const preview = evaluateLeavePreview(context, input);
	assert.equal(preview.remaining_days, 12);
	assert.equal(preview.chargeable_days, 1);
	assert.deepEqual(preview.issues, []);
	assert.deepEqual(context.entries, []);
	assert.throws(
		() => evaluateLeavePreview({ ...context, employments: [] }, input),
		/approved employment/
	);
});

test('held applications reserve availability and overdraw returns an actionable preview issue', () => {
	const context = leaveContext();
	const pending = approve(context, timeOff('2026-05-01', '2026-05-03'));
	context.entries[0] = { ...pending, approval_id: id(100) };
	assert.equal(evaluateLeavePreview(context, input).remaining_days, 9);
	const overdrawn = evaluateLeavePreview(context, {
		...input,
		range: { start: range.start, end: { date: '2026-04-24', half: 'SECOND' } }
	});
	assert.equal(
		overdrawn.chargeable_days,
		10,
		'the selection remains measurable when approval would overdraw'
	);
	assert.match(overdrawn.issues[0]?.message ?? '', /Insufficient leave/);
});

test('unlimited leave keeps schedule and overlap validation without a balance ceiling', () => {
	const context = leaveContext();
	context.catalogues[0]!.entitlement = {
		availability: 'UNLIMITED',
		proration: 'NONE',
		year_start_month: 1,
		bands: []
	};
	const preview = evaluateLeavePreview(context, input);
	assert.equal(preview.remaining_days, null);
	assert.equal(preview.chargeable_days, 1);
	assert.deepEqual(preview.issues, []);
	approve(context, timeOff(range.start.date));
	const overlap = evaluateLeavePreview(context, input);
	assert.equal(overlap.availability[range.start.date]?.reason_code, 'OTHER_LEAVE');
	assert.match(overlap.issues[0]?.message ?? '', /overlaps/);
});

test('eligibility and certificate thresholds use server-measured scheduled days', () => {
	const context = leaveContext();
	context.catalogues[0]!.requires_certificate_after_days = 0;
	context.catalogues[0]!.eligibility =
		'employee.gender == "FEMALE" && employment.type == "PERMANENT"';
	assert.equal(evaluateLeavePreview(context, input).certificate_required, true);
	context.employees[0]!.gender = 'MALE';
	const ineligible = evaluateLeavePreview(context, input);
	assert.equal(ineligible.availability[range.start.date]?.reason_code, 'INELIGIBLE');
	assert.match(ineligible.issues[0]?.message ?? '', /INELIGIBLE/);
});

test('preview distinguishes an occupied half from the available half on the same date', () => {
	const context = leaveContext();
	const held = approve(context, {
		kind: 'TIME_OFF',
		range: { start: range.start, end: range.start },
		chargeable_days: null,
		reason: null
	});
	context.entries[0] = { ...held, approval_id: id(100) };
	const preview = evaluateLeavePreview(context, {
		...input,
		range: { start: range.end, end: range.end }
	});
	assert.equal(preview.availability[range.start.date]?.first_half_available, false);
	assert.equal(preview.availability[range.start.date]?.second_half_available, true);
	assert.equal(preview.chargeable_days, 0.5);
	assert.deepEqual(preview.issues, []);
});

test('observed holidays remain non-chargeable in a multi-day preview', () => {
	const context = leaveContext();
	context.holidays.push({
		id: 'holiday-2026-04-16',
		jurisdiction_code: 'TEST-JUR',
		date: '2026-04-16',
		name: 'Observed holiday',
		original_date: null,
		published_at: '2025-01-01T00:00:00.000Z'
	});
	const preview = evaluateLeavePreview(context, {
		...input,
		range: { start: range.start, end: { date: '2026-04-17', half: 'SECOND' } }
	});
	assert.equal(preview.chargeable_days, 2);
	assert.equal(preview.availability['2026-04-16']?.reason_code, 'HOLIDAY');
	assert.deepEqual(preview.issues, []);
});

test('preview month expands to the rendered calendar grid and retains out-of-grid selection dates', () => {
	assert.deepEqual(previewWindowOf({ ...input, range: undefined }), {
		start: '2026-03-30',
		end: '2026-05-10'
	});
	assert.deepEqual(
		previewWindowOf({
			...input,
			range: {
				start: { date: '2026-03-01', half: 'FIRST' },
				end: { date: '2026-05-15', half: 'SECOND' }
			}
		}),
		{ start: '2026-03-01', end: '2026-05-15' }
	);
});

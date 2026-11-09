import { automation } from '@norbital-ai/bolt';
import { dynamicRead } from '@norbital-ai/bolt/protocol';
import { addDays, PlainDate } from '@norbital-ai/std/date';
import { isJsonObject } from '../lib/payroll_engine/foundation.js';

/**
 * One contract-exit fact per ended employment that has no same-jurisdiction successor. Exit duties read this fact, not
 * the contract update, so a pay bump or a same-jurisdiction replacement raises none.
 */
export default automation('contract_exits', {
	description: 'Record ended employments that have no same-jurisdiction successor; safe to run repeatedly.',
	input: { employments: { kind: 'list', of: { kind: 'id', of: 'employee_contract' } } },
	policies: ['payroll_execution'],
	concurrency: { max: 1 },
	run: function* ({ employments }, ctx) {
		if (employments.length === 0) return;
		const ended = yield* ctx.query(
			dynamicRead({
				employee_contract: {
					where: { id: { in: [...employments] } },
					fields: [
						'id',
						'employee_id',
						'entity_id',
						'status',
						'effective_range',
						'final_pay_due_on',
						'input_schema_version_id'
					] as const,
					limit: 10000
				}
			})
		);
		const rows = ended.employee_contract?.rows ?? [];
		if (rows.length === 0) return;
		const employees = [...new Set(rows.map((row) => String(row.employee_id)))];
		const family = yield* ctx.query(
			dynamicRead({
				employee_contract: {
					where: { employee_id: { in: employees } },
					fields: ['id', 'employee_id', 'status', 'effective_range', 'input_schema_version_id'] as const,
					limit: 10000
				}
			})
		);
		const settings = yield* ctx.query(
			dynamicRead({
				jurisdiction_settings: { fields: ['id', 'code'] as const, limit: 10000 }
			})
		);
		const held = yield* ctx.query(
			dynamicRead({
				contract_exit: {
					where: { employment_id: { in: rows.map((row) => String(row.id)) } },
					fields: ['employment_id'] as const,
					limit: 10000
				}
			})
		);
		const already = new Set((held.contract_exit?.rows ?? []).map((row) => String(row.employment_id)));
		const codes = new Map(
			(settings.jurisdiction_settings?.rows ?? []).map((row) => [String(row.id), String(row.code)])
		);
		const idOf = (value: unknown): string =>
			isJsonObject(value) && typeof value.id === 'string' ? value.id : String(value ?? '');
		const rangeOf = (value: unknown): { from: string; to: string | null } | null => {
			if (isJsonObject(value))
				return {
					from: String(value.from ?? ''),
					to: value.to == null ? null : String(value.to)
				};
			if (typeof value !== 'string') return null;
			const end = value.slice(value.indexOf(',') + 1, -1);
			return { from: value.slice(1, value.indexOf(',')), to: end === '' ? null : end };
		};
		const input = rows.flatMap((row) => {
			if (row.status !== 'SEALED' || already.has(String(row.id))) return [];
			const range = rangeOf(row.effective_range);
			if (range === null || range.to === null) return [];
			const to = range.to;
			const own = codes.get(idOf(row.input_schema_version_id));
			const successor = (family.employee_contract?.rows ?? []).some((other) => {
				if (String(other.id) === String(row.id)) return false;
				if (other.status !== 'DRAFT' && other.status !== 'SEALED') return false;
				const otherRange = rangeOf(other.effective_range);
				return (
					otherRange !== null &&
					otherRange.from > to &&
					codes.get(idOf(other.input_schema_version_id)) === own
				);
			});
			if (successor) return [];
			const settingsId = idOf(row.input_schema_version_id);
			if (settingsId === '') return [];
			return [
				{
					employment_id: String(row.id),
					employee_id: String(row.employee_id),
					entity_id: String(row.entity_id),
					settings_id: settingsId,
					effective_to: PlainDate(to),
					...(row.final_pay_due_on == null
						? {}
						: { final_pay_due_on: PlainDate(String(row.final_pay_due_on)) })
				}
			];
		});
		if (input.length > 0)
			yield* ctx.act.checked([{ callable: 'contract_exit.create', input }]);
	}
});

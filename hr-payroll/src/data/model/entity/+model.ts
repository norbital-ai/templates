import { model } from '@norbital-ai/bolt';
import { beforeOf } from '../../../lib/payroll_engine/foundation.js';
import { payScheduleRefusal } from '../../../lib/payroll_engine/frequency.js';
import { SALARY_RUNS } from '../../../lib/payroll_engine/payslip/context.js';
import { moved, tap } from '../../../lib/payroll_engine/taps.js';

const columns = [
	'settings_code',
	'name',
	'registration_number',
	'pay_cutoff_day',
	'late_arrival_grace_minutes',
	'pay_frequency',
	'pay_frequency_changes',
	'risk_class',
	'region',
	'facts',
	'time_zone',
	'disbursement_account',
	'payment_bank_id',
	'effective_range',
	'hotline',
	'validation_severity'
] as const;
const SCHEDULE = ['pay_frequency', 'pay_frequency_changes'];
/** Whether an update changes the pay schedule. */
const reschedules = (before: object, set: object) =>
	Object.keys(beforeOf(before, set)).some((field) => SCHEDULE.includes(field));

export default model('entity', {
	description:
		'An employing entity bound to one jurisdiction settings lineage: its attendance cutoff, pay frequency and risk class. Headcount is derived from active employment contracts, never stored.',
	icon: 'lucide:building-2',
	label: 'name',
	fields: {
		settings_code: {
			kind: 'text'
		},
		name: {
			kind: 'text'
		},
		registration_number: {
			kind: 'text',
			optional: true
		},
		pay_cutoff_day: {
			kind: 'int',
			min: 1,
			max: 28,
			help: 'The day attendance closes: 1 attends the calendar month; 2–28 attend from the previous month’s cutoff through the day before this one.'
		},
		late_arrival_grace_minutes: {
			kind: 'int',
			min: 0,
			default: 15
		},
		pay_frequency: {
			kind: 'enum',
			values: ['MONTHLY', 'SEMI_MONTHLY', 'TEN_DAY', 'INTEGER_MONTHS', 'WEEKLY', 'DAILY'],
			default: 'MONTHLY',
			help: 'The frequency the entity pays at from its start; a later switch is a `pay_frequency_changes` row.'
		},
		pay_frequency_changes: {
			kind: 'json',
			shape: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						from: { kind: 'date' },
						frequency: {
							kind: 'enum',
							values: ['MONTHLY', 'SEMI_MONTHLY', 'TEN_DAY', 'INTEGER_MONTHS', 'WEEKLY', 'DAILY']
						}
					}
				}
			},
			default: [],
			help: 'Each switch of pay frequency, from its first day: a past period always reads the frequency then in force.'
		},
		risk_class: {
			kind: 'text',
			optional: true
		},
		region: {
			kind: 'text',
			optional: true
		},
		late_arrival_team: {
			kind: 'text',
			format: 'team',
			optional: true,
			help: 'The team handle late-arrival reminders go to (`late_arrival_notice`); an entity naming none sends none.'
		},
		facts: {
			kind: 'json',
			shape: {
				kind: 'record',
				of: { kind: 'json' }
			},
			default: {},
			help: "The entity facts the jurisdiction's entity input schema declares."
		},
		before: {
			kind: 'json',
			shape: {
				kind: 'record',
				of: { kind: 'json' }
			},
			optional: true,
			help: 'The prior values of the fields the last update changed, recorded for the duties that answer a change.'
		},
		time_zone: {
			kind: 'text',
			optional: true,
			help: "The zone this entity's payroll windows and rostered days are counted in."
		},
		disbursement_account: {
			kind: 'json',
			shape: {
				kind: 'object',
				fields: {
					bank_name: {
						kind: 'text'
					},
					bank_code: {
						kind: 'text'
					},
					bank_account_number: {
						kind: 'text'
					},
					bank_account_name: {
						kind: 'text'
					}
				}
			},
			optional: true
		},
		validation_severity: {
			kind: 'json',
			shape: {
				kind: 'object',
				fields: {
					default: { kind: 'enum', values: ['refuse', 'warn', 'record'] },
					rules: {
						kind: 'record',
						of: { kind: 'enum', values: ['refuse', 'warn', 'hold'] }
					}
				}
			},
			optional: true,
			help: "How the jurisdiction's validations and statutory guards bind this entity: a rule's own override (by its code), else `default`; `record` keeps the rule's own kind. Absent keeps every rule's own kind."
		},
		effective_range: {
			kind: 'period',
			of: 'date'
		},
		payment_bank_id: {
			kind: 'ref',
			to: 'bank',
			inverse: 'entities',
			optional: true
		},
		/** The WhatsApp number the entity's payroll hotline answers on (`payroll_hotline` scopes its turns to it). */
		hotline: {
			kind: 'ref',
			to: 'sys_integration',
			optional: true,
			onDelete: 'setNull',
			where: { integration: { eq: 'whatsapp' } }
		}
	},
	read: {
		entity: { fields: 'all' },
		'entity.shift_definition': { fields: 'all' },
		'entity.employment_contract': { fields: 'all' },
		'entity.employment_contract.employee_id': { fields: 'all' },
		'entity.employment_contract.roster_entry': { fields: 'all' },
		'entity.employment_contract.leave_catalog_entry': { fields: 'all' }
	},
	outputs: {
		// the attendance kiosk: the entity, its employments, people and days; no leave
		kiosk: {
			entity: { fields: ['name', 'settings_code'] },
			'entity.employment_contract': {
				fields: ['employee_id', 'company_id', 'employee_number', 'effective_range']
			},
			'entity.employment_contract.employee_id': {
				fields: [
					'name',
					'email',
					'phone',
					'face_embedding',
					'face_photo',
					'face_enrollment_status',
					'face_enrolled_at',
					'face_match_count',
					'face_last_match_at'
				]
			},
			'entity.employment_contract.roster_entry': {
				fields: ['employment_id', 'work_date', 'worked_intervals']
			}
		}
	},
	create: {
		columns: { entity: columns },
		// For now every validation of a new entity only warns, until HR chooses otherwise.
		transform: function* (rows) {
			return rows.map((row) => ({
				validation_severity: { default: 'warn' as const, rules: {} },
				...row
			}));
		}
	},
	update: {
		columns: { entity: columns },
		/**
		 * An update records what it changed (never the disbursement account), so a duty can answer a re-registration. A
		 * pay schedule change is history: refused when it would rewrite a period a salary run paid (`payScheduleRefusal`),
		 * the entities' runs read once, only when a write touches the schedule.
		 */
		transform: function* (changes, ctx) {
			const touched = changes.flatMap(({ before, set }) =>
				reschedules(before, set) ? [before.id] : []
			);
			const runs =
				touched.length === 0
					? []
					: (yield* ctx.db.query({
							payroll_run: {
								where: { company_id: { in: touched }, kind: { in: [...SALARY_RUNS] } },
								fields: ['company_id', 'salary_to']
							}
						})).payroll_run.rows;
			for (const [row, { before, set }] of changes.entries()) {
				if (!reschedules(before, set)) continue;
				const lastPaid =
					runs
						.filter((run) => run.company_id === before.id && run.salary_to != null)
						.map((run) => String(run.salary_to).slice(0, 10))
						.toSorted()
						.at(-1) ?? null;
				const refusal = payScheduleRefusal(before, { ...before, ...set }, lastPaid);
				if (refusal !== undefined) return yield* ctx.refuse(refusal, { row });
			}
			return changes.map(({ before, set }) => {
				const { disbursement_account: _account, ...changed } = beforeOf(before, set);
				return { ...set, before: changed };
			});
		}
	},
	// The jurisdiction behaviour rules for this model's writes (`behaviour_taps`), started as the writer.
	effect: {
		created: function* (rows, ctx) {
			yield* tap(ctx, 'created', { model: 'entity', ids: rows.map((row) => row.id) });
		},
		updated: function* (changes, ctx) {
			// every declared field but its refs and `before`
			const ids = moved(changes, [
				'settings_code',
				'name',
				'registration_number',
				'pay_cutoff_day',
				'late_arrival_grace_minutes',
				'pay_frequency',
				'pay_frequency_changes',
				'risk_class',
				'region',
				'late_arrival_team',
				'facts',
				'time_zone',
				'disbursement_account',
				'validation_severity',
				'effective_range'
			]);
			yield* tap(ctx, 'updated', { model: 'entity', ids });
		}
	}
});

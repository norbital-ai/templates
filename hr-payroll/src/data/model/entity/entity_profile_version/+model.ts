import { model } from '@norbital-ai/bolt';
import { tap } from '../../../../lib/payroll_engine/taps.js';
import { jsonObject } from '../../../../lib/payroll_engine/foundation.js';
import { validateRegistered } from '../../../../lib/payroll_engine/registrations.js';

export default model('entity_profile_version', {
	description:
		'Sealed employer data. A dated replacement changes future values; consumed historical values remain protected.',
	label: 'name',
	fields: {
		statutory_units: {
			kind: 'list',
			optional: true,
			of: {
				kind: 'object',
				fields: {
					key: { kind: 'text' },
					kind: { kind: 'text' },
					name: { kind: 'text' },
					registrations: {
						kind: 'list',
						optional: true,
						of: {
							kind: 'object',
							fields: {
								scheme_code: {
									kind: 'text',
									help: 'The actual registration scheme code defined by the governing catalogue lookup.'
								},
								number: {
									kind: 'text',
									help: 'The actual assigned account or member identifier, preserving leading zeros and its original format.'
								},
								period: { kind: 'period', of: 'date', optional: true }
							}
						}
					}
				}
			}
		},
		input_schema_version_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'employer_payroll_versions',
			onDelete: 'restrict',
			where: { status: { eq: 'SEALED' } }
		},
		settings_code: {
			kind: 'text'
		},
		name: {
			kind: 'text'
		},
		registrations: {
			kind: 'list',
			optional: true,
			of: {
				kind: 'object',
				fields: {
					scheme_code: {
						kind: 'text',
						help: 'The actual registration scheme code defined by the governing catalogue lookup.'
					},
					number: {
						kind: 'text',
						help: 'The actual assigned account or member identifier, preserving leading zeros and its original format.'
					},
					period: { kind: 'period', of: 'date', optional: true }
				}
			}
		},
		registered_address: { kind: 'text', optional: true },
		final_pay_loan_floor_percent: {
			kind: 'int',
			min: 0,
			max: 100,
			default: 10,
			help: 'The share of expected final pay that must remain after loan recovery.'
		},
		overtime_full_award_percent: {
			kind: 'int',
			min: 1,
			max: 100,
			default: 100,
			help: 'How much of planned overtime the clock must cover to pay all of it. Below this, the clocked time pays, rounded down to the half hour.'
		},
		entity_extension_data: {
			kind: 'json',
			shape: { kind: 'record', of: { kind: 'json' } },
			default: {},
			help: "The entity data the jurisdiction's entity extension schema declares."
		},
		time_zone: {
			kind: 'text',
			optional: true,
			help: "The zone this entity's payroll windows and rostered days are counted in."
		},
		payment_schedule: {
			kind: 'json',
			shape: {
				kind: 'union',
				by: 'frequency',
				arms: {
					MONTHLY: {
						business_day: { kind: 'enum', values: ['NONE', 'PREVIOUS', 'NEXT'] },
						non_working_weekdays: { kind: 'list', of: { kind: 'int', min: 0, max: 6 } },
						short_month: { kind: 'enum', values: ['LAST_DAY', 'REFUSE'] },
						anchors: {
							kind: 'list',
							min: 1,
							of: {
								kind: 'object',
								fields: {
									cycle_part: { kind: 'int', min: 1 },
									day: { kind: 'int', min: 1, max: 31 },
									month_offset: { kind: 'int', min: 0, max: 2 }
								}
							}
						}
					},
					SEMI_MONTHLY: {
						business_day: { kind: 'enum', values: ['NONE', 'PREVIOUS', 'NEXT'] },
						non_working_weekdays: { kind: 'list', of: { kind: 'int', min: 0, max: 6 } },
						short_month: { kind: 'enum', values: ['LAST_DAY', 'REFUSE'] },
						anchors: {
							kind: 'list',
							min: 1,
							of: {
								kind: 'object',
								fields: {
									cycle_part: { kind: 'int', min: 1 },
									day: { kind: 'int', min: 1, max: 31 },
									month_offset: { kind: 'int', min: 0, max: 2 }
								}
							}
						}
					},
					TEN_DAY: {
						business_day: { kind: 'enum', values: ['NONE', 'PREVIOUS', 'NEXT'] },
						non_working_weekdays: { kind: 'list', of: { kind: 'int', min: 0, max: 6 } },
						short_month: { kind: 'enum', values: ['LAST_DAY', 'REFUSE'] },
						anchors: {
							kind: 'list',
							min: 1,
							of: {
								kind: 'object',
								fields: {
									cycle_part: { kind: 'int', min: 1 },
									day: { kind: 'int', min: 1, max: 31 },
									month_offset: { kind: 'int', min: 0, max: 2 }
								}
							}
						}
					},
					INTEGER_MONTHS: {
						business_day: { kind: 'enum', values: ['NONE', 'PREVIOUS', 'NEXT'] },
						non_working_weekdays: { kind: 'list', of: { kind: 'int', min: 0, max: 6 } },
						short_month: { kind: 'enum', values: ['LAST_DAY', 'REFUSE'] },
						anchors: {
							kind: 'list',
							min: 1,
							of: {
								kind: 'object',
								fields: {
									cycle_part: { kind: 'int', min: 1 },
									day: { kind: 'int', min: 1, max: 31 },
									month_offset: { kind: 'int', min: 0, max: 2 }
								}
							}
						},
						month_interval: { kind: 'int', min: 1, max: 12 },
						anchor_date: { kind: 'date' }
					},
					WEEKLY: {
						business_day: { kind: 'enum', values: ['NONE', 'PREVIOUS', 'NEXT'] },
						non_working_weekdays: { kind: 'list', of: { kind: 'int', min: 0, max: 6 } },
						short_month: { kind: 'enum', values: ['LAST_DAY', 'REFUSE'] },
						weekday: { kind: 'int', min: 0, max: 6 },
						anchor_date: { kind: 'date' }
					},
					BIWEEKLY: {
						business_day: { kind: 'enum', values: ['NONE', 'PREVIOUS', 'NEXT'] },
						non_working_weekdays: { kind: 'list', of: { kind: 'int', min: 0, max: 6 } },
						short_month: { kind: 'enum', values: ['LAST_DAY', 'REFUSE'] },
						weekday: { kind: 'int', min: 0, max: 6 },
						anchor_date: { kind: 'date' }
					},
					DAILY: {
						business_day: { kind: 'enum', values: ['NONE', 'PREVIOUS', 'NEXT'] },
						non_working_weekdays: { kind: 'list', of: { kind: 'int', min: 0, max: 6 } },
						short_month: { kind: 'enum', values: ['LAST_DAY', 'REFUSE'] }
					}
				}
			}
		},
		pay_cutoff_day: {
			kind: 'int',
			min: 1,
			max: 28,
			help: 'The day attendance closes: 1 attends the calendar month; 2–28 attend from the previous month’s cutoff through the day before this one.'
		},
		bank: { kind: 'custom', of: 'bank', optional: true },

		effective_range: {
			kind: 'period',
			of: 'date'
		},

		status: {
			kind: 'state',
			initial: 'DRAFT',
			states: {
				DRAFT: { to: ['SEALED'], edit: 'all' },
				SEALED: { to: ['VOID'], edit: ['effective_range', 'reason'] },
				VOID: { to: [], edit: 'none' }
			}
		},
		entity_id: { kind: 'ref', to: 'entity', inverse: 'payroll_versions', onDelete: 'restrict' },
		reason: { kind: 'text', optional: true }
	},
	noOverlap: [
		{ key: ['entity_id'], period: 'effective_range', where: { status: { eq: 'SEALED' } } }
	],
	read: {
		entity_profile_version: { fields: 'all' },
		'entity_profile_version.entity_id': { fields: 'all' },
		'entity_profile_version.input_schema_version_id': { fields: 'all' }
	},
	outputs: {
		kiosk: {
			entity_profile_version: {
				fields: ['entity_id', 'effective_range', 'status', 'time_zone']
			}
		}
	},
	create: {
		columns: {
			entity_profile_version: [
				'entity_id',
				'name',
				'effective_range',
				'settings_code',
				'input_schema_version_id',
				'time_zone',
				'payment_schedule',
				'pay_cutoff_day',
				'registrations',
				'registered_address',
				'final_pay_loan_floor_percent',
				'overtime_full_award_percent',
				'bank',
				'statutory_units',
				'entity_extension_data',
				'status',
				'reason'
			]
		},
		transform: function* (rows, ctx) {
			yield* validateRegistered(
				ctx.db.query,
				'entity_profile_version',
				'create',
				rows.map((row) => jsonObject(row))
			);
			return rows;
		}
	},
	update: {
		transform: function* (changes, ctx) {
			const substantive = changes.filter((change) => change.set.status !== 'VOID');
			if (substantive.length > 0)
				yield* validateRegistered(
					ctx.db.query,
					'entity_profile_version',
					'update',
					substantive.map((change) => jsonObject({ ...change.before, ...change.set }))
				);
			for (const { set } of changes) {
				if (set.status === 'VOID' && !set.reason?.trim())
					return yield* ctx.refuse('Record why this version is void.');
			}
			return changes.map((change) => change.set);
		},
		columns: {
			entity_profile_version: [
				'entity_id',
				'name',
				'effective_range',
				'settings_code',
				'input_schema_version_id',
				'time_zone',
				'payment_schedule',
				'pay_cutoff_day',
				'registrations',
				'registered_address',
				'final_pay_loan_floor_percent',
				'overtime_full_award_percent',
				'bank',
				'statutory_units',
				'entity_extension_data',
				'status',
				'reason'
			]
		}
	},
	effect: {
		created: function* (rows, ctx) {
			yield* tap(
				ctx,
				'create',
				{ collection: 'entity_profile_version', ids: rows.map((r) => r.id) },
				rows.map((after) => ({ after }))
			);
		},
		updated: function* (changes, ctx) {
			if (
				changes.some(({ before, after }) => before.status !== 'SEALED' && after.status === 'SEALED')
			)
				yield* ctx.schedule('ledger', {}, { key: 'ledger' });
			yield* tap(
				ctx,
				'update',
				{ collection: 'entity_profile_version', ids: changes.map((c) => c.after.id) },
				changes
			);
		}
	}
});

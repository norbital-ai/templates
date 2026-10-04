import { model } from '@norbital-ai/bolt';

export default model({
 description: 'Static allowance definitions governed by a jurisdiction snapshot. Qualified employee/entity inputs produce a payslip line directly; no allowance entry is created.',
 icon: 'lucide:calendar-clock',
 label: 'code',
 fields: {
  code: { kind: 'text' },
  name: { kind: 'text', optional: true },
  authority: { kind: 'text', optional: true },
  counts_toward: { kind: 'json', shape: { kind: 'list', of: { kind: 'text' } }, default: [] },
  statutory_admission: { kind: 'json', shape: { kind: 'list', of: { kind: 'object', fields: { id: { kind: 'text' }, when: { kind: 'text' }, message: { kind: 'text' } } } }, default: [] },
  valuation: { kind: 'json', shape: { kind: 'object', fields: { owed: { kind: 'bool', optional: true }, npl_prorates: { kind: 'bool', optional: true }, outpatient_sick_pay: { kind: 'enum', values: ['INCLUDE', 'EXCLUDE'], optional: true }, plain_rate: { kind: 'bool' } } }, help: 'Declared original hourly leave-rate inclusion and plain contractual rate admission.' },
  statutory_value: { kind: 'text', optional: true, help: 'CEL expression for the original unprorated contractual statutory value, using actual qualified assignment and schedule facts.' },
  measurement: { kind: 'json', shape: { kind: 'object', fields: { period: { kind: 'enum', values: ['MONTH', 'WEEK'] }, unit: { kind: 'enum', values: ['CONTRACT_FRACTION', 'PAID_NORMAL_HOUR', 'PAID_NORMAL_DAY'] }, unpaid: { kind: 'text' }, instalments: { kind: 'text', optional: true }, working_day: { kind: 'text', optional: true }, unpaid_quantity: { kind: 'text', optional: true }, holiday_quantity: { kind: 'text', optional: true }, holiday_forfeit: { kind: 'text', optional: true }, weekly_hours: { kind: 'text', optional: true }, weekly_days: { kind: 'text', optional: true }, allocation_reference: { kind: 'text', optional: true }, monthly_equivalent: { kind: 'text', optional: true }, monthly_equivalent_reference: { kind: 'text', optional: true }, month_weeks: { kind: 'text', optional: true }, allocation: { kind: 'json', optional: true }, guaranteed: { kind: 'object', fields: { amount: { kind: 'text' }, valid_when: { kind: 'text' }, message: { kind: 'text' }, leave_when: { kind: 'text' } }, optional: true } } }, optional: true, help: 'Configured dated measurement and source admission policies; expressions consume qualified original contract and attendance captures.' },
  value_schema: { kind: 'json', optional: true, help: 'Original contractual allowance value schema, including conditional admission and owned evidence requirements.' },
  inputs: { kind: 'json', shape: { kind: 'record', of: { kind: 'object', fields: { source: { kind: 'enum', values: ['EMPLOYEE', 'ENTITY'] }, subject: { kind: 'text' }, key: { kind: 'text' },key_expression:{kind:'text',optional:true} } } }, default: {} },
  records: { kind: 'json', shape: { kind: 'list', of: { kind: 'object', fields: { id: { kind: 'text' }, collection: { kind: 'text' }, fields: { kind: 'list', of: { kind: 'text' } }, where: { kind: 'record', of: { kind: 'json' } }, limit: { kind: 'int', min: 1, max: 1000 } } } }, default: [] },
  derived: { kind: 'json', shape: { kind: 'list', of: { kind: 'object', fields: { id: { kind: 'text' }, expression: { kind: 'text' } } } }, default: [] },
  admission: { kind: 'json', shape: { kind: 'list', of: { kind: 'object', fields: { id: { kind: 'text' }, when: { kind: 'text' }, message: { kind: 'text' } } } }, default: [] },
  eligibility: { kind: 'text' },
  quantity: { kind: 'text' },
  rate: { kind: 'text' },
  amount: { kind: 'text', help: 'CEL amount expression; include rnd(value, step, mode) when required by the governing source.' },
  destination: { kind: 'enum', values: ['PAY', 'NET', 'EMPLOYER', 'DISPLAY'] },
  direction: { kind: 'enum', values: ['ADD', 'SUBTRACT'] }
 },
 unique: [{ fields: ['settings_id', 'code'] }]
});

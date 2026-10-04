import { model } from '@norbital-ai/bolt';

export default model({
 description: 'Static work earning definitions governed by a jurisdiction snapshot. Qualified roster inputs produce a payslip line directly; no work request record is created.',
 icon: 'lucide:clock',
 label: 'code',
 fields: {
  code: { kind: 'text' },
  original_id: { kind: 'text' },
  original_order: { kind: 'int', min: 0 },
  output: { kind: 'text' },
  component_code: { kind: 'text' },
  phase: {kind:'enum',values:['INITIAL','AFTER_LEAVE','AFTER_ENTRIES'],default:'INITIAL'},
  mode: { kind: 'enum', values: ['OVERTIME', 'NORMAL_DAY', 'SCHEDULED_CASH', 'BASE', 'ABSENCE', 'NIGHT_PREMIUM', 'NIGHT_WAGE', 'WEEKLY_WORK', 'RESULTS_BASE', 'MINIMUM_WAGE', 'DERIVED'] },
  source_policy: { kind: 'json', help: 'Reference to the immutable shared capture recipe in the owning WORK rule set.' },
  cash_rounding: { kind: 'json', optional: true, help: 'Original configured cash settlement scope and eligibility expression. Period-component cumulative rounding retains its shared component identity.' },
  name: { kind: 'text', optional: true },
  measurement_output: { kind: 'text', optional: true, help: 'Configured projection of actual complete period measurements into native work outputs.' },
  measurement: { kind: 'json', optional: true, help: 'Configuration for original full-period static work measurements and exact salary proration.' },
  program: { kind: 'json', optional: true, help: 'Ordered CEL capture, admission and output instructions; work awards retain their original daily consumption order.' },
  eligibility: { kind: 'text' },
  quantity: { kind: 'text' },
  rate: { kind: 'text' },
  amount: { kind: 'text', help: 'CEL amount expression; include rnd(value, step, mode) when required by the governing source.' },
  destination: { kind: 'enum', values: ['PAY', 'NET', 'EMPLOYER', 'DISPLAY'] },
  direction: { kind: 'enum', values: ['ADD', 'SUBTRACT'] }
 },
 unique: [{ fields: ['settings_id', 'code'] }]
});

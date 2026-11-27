import { model } from '@norbital-ai/bolt';

const columns = [
	'project_id',
	'reporting_period',
	'electricity_kwh',
	'diesel_litres',
	'transport_tco2e',
	'water_m3',
	'newater_m3',
	'waste_generated_t',
	'waste_diverted_t',
	'waste_hazardous_t',
	'notes'
] as const;

export default model('sustainability_logs', {
	icon: 'lucide:leaf',
	record_label:
		"record.reporting_period != null ? record.reporting_period.from + (record.reporting_period.to != null ? ' – ' + record.reporting_period.to : '') : 'Site log'",
	description:
		'Periodic construction site energy, fuel, transport, water, and C&D waste ledger supporting EN 15978 A4–A5, BCA Green Mark Whole Life Carbon, ISO 14064-1 Scope 1 & 2, and SGX / GRI 302–306 reporting.',
	fields: {
		project_id: { kind: 'ref', to: 'projects', inverse: 'sustainability_logs', owned: true },
		reporting_period: { kind: 'period', of: 'date' },
		/** Purchased site grid electricity (kWh) — Scope 2 / GRI 302-1. */
		electricity_kwh: { kind: 'decimal', scale: 2, default: 0 },
		/** On-site diesel / machinery fuel consumed (litres) — Scope 1 / A5 / GRI 302-1. */
		diesel_litres: { kind: 'decimal', scale: 2, default: 0 },
		/** Upstream material haulage & site logistics emissions (tCO₂e) — EN 15978 Module A4. */
		transport_tco2e: { kind: 'decimal', scale: 3, default: 0 },
		/** Total municipal & site water withdrawn (m³) — GRI 303-5. */
		water_m3: { kind: 'decimal', scale: 2, default: 0 },
		/** Recycled / NEWater portion of site water use (m³) — GRI 303-5. */
		newater_m3: { kind: 'decimal', scale: 2, default: 0 },
		/** Total construction & demolition (C&D) waste generated (tonnes) — GRI 306-3. */
		waste_generated_t: { kind: 'decimal', scale: 2, default: 0 },
		/** C&D waste recycled, reused, or salvaged from disposal (tonnes) — GRI 306-4. */
		waste_diverted_t: { kind: 'decimal', scale: 2, default: 0 },
		/** Hazardous construction waste disposed (tonnes) — GRI 306-5. */
		waste_hazardous_t: { kind: 'decimal', scale: 2, default: 0 },
		notes: { kind: 'text', optional: true }
	},
	constraints: {
		non_negative_energy: {
			check: {
				electricity_kwh: { gte: 0 },
				diesel_litres: { gte: 0 },
				transport_tco2e: { gte: 0 }
			}
		},
		non_negative_water_waste: {
			check: {
				water_m3: { gte: 0 },
				newater_m3: { gte: 0 },
				waste_generated_t: { gte: 0 },
				waste_diverted_t: { gte: 0 },
				waste_hazardous_t: { gte: 0 }
			}
		}
	},
	indexes: {
		by_project: { on: ['project_id'] }
	},
	outputs: {
		default: {
			fields: 'all',
			project_id: { fields: ['project_name', 'project_number'] }
		}
	},
	create: { fields: columns },
	update: { fields: columns.filter((f) => f !== 'project_id') },
	delete: {}
});

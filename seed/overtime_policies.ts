import { createHash } from 'node:crypto';
import { Predicate, type Schema } from 'effect';

type Limit = {
	code: string;
	from: string;
	limit: string;
	applies: string;
	hours: string;
};

const approved = 'day.approved_overtime_hours';
const month = 'month_start(day.date)';
const year = 'day.date.substring(0, 4) + "-01-01"';
const ordinaryId = '(day.day_type == "WORK" || day.day_type == "") && day.holiday_kind == ""';
const part4 =
	'((terms.statutory_work_category != "NON_MANUAL" && terms.base_salary <= 4500.0) || (terms.statutory_work_category == "NON_MANUAL" && terms.base_salary <= 2600.0))';
const standardCn = 'terms.work_classification in ["STANDARD", ""]';
const ordinaryCn =
	'!((day.day_type in ["REST", "OFF"] || day.holiday_kind == "SUBSTITUTE") && day.holiday_kind != "PUBLIC_HOLIDAY" && day.holiday_kind != "MAKEUP_WORKDAY") && day.holiday_kind != "PUBLIC_HOLIDAY"';
const coveredTw =
	'!(has(company.facts.responsibility_system) && company.facts.responsibility_system == true && has(terms.facts) && has(terms.facts.responsibility_system_agreement) && terms.facts.responsibility_system_agreement != "")';
const extendedTw =
	'(has(company.facts.overtime_extension_approval_on) && company.facts.overtime_extension_approval_on != "" && company.facts.overtime_extension_approval_on <= day.date && has(company.facts.overtime_extension_approved_by) && company.facts.overtime_extension_approved_by in ["UNION", "LABOUR_MANAGEMENT_CONFERENCE"])';
const holidayTw =
	'(day.holiday_kind in ["PUBLIC_HOLIDAY", "SUBSTITUTE", "DOUBLE_HOLIDAY", "DOUBLE_SPECIAL"] || (day.holiday_kind == "SPECIAL_HOLIDAY" && (has(employee.facts.voting_right) ? employee.facts.voting_right == true : (employee.nationality == "TW" && has(employee.date_of_birth) && employee.date_of_birth != null && employee.date_of_birth != "" && age_on(employee.date_of_birth, day.date) >= 20))))';
const coveredJp = '!(terms.work_classification in ["MANAGERIAL", "OFFICER"])';
const limitedSectorJp =
	'(has(company.facts.overtime_sector) ? company.facts.overtime_sector : "GENERAL") != "NEW_TECH_RD"';
const generalSectorJp =
	'(has(company.facts.overtime_sector) ? company.facts.overtime_sector : "GENERAL") in ["GENERAL", "CONSTRUCTION"]';
const agreementYearJp =
	'(has(company.facts.overtime_agreement_from) ? (day.date.substring(5, 7) >= company.facts.overtime_agreement_from.substring(5, 7) ? day.date.substring(0, 4) : string(int(day.date.substring(0, 4)) - 1)) + "-" + company.facts.overtime_agreement_from.substring(5, 7) + "-01" : day.date.substring(0, 4) + "-01-01")';

const ceiling = (
	code: string,
	from: string,
	limit: string,
	applies = 'true',
	hours = approved
): Limit => ({ code, from, limit, applies, hours });

/** Existing seeded ceilings; warning and payment expressions retain their independent full-hour roots. */
const policies: Record<string, Limit[]> = {
	// Employment Act Part IV: the existing cap warnings also include part-time workers.
	SG: [
		ceiling('DAILY_HOURS_CAP', 'day.date', 'max(0.0, 12.0 - day.scheduled_hours)', part4),
		ceiling('OVERTIME_MONTHLY_CAP', month, '72.0', part4)
	],
	// The seeded warnings apply beyond the narrower ordinary-overtime payment eligibility.
	MY: [
		ceiling('DAILY_HOURS_CAP', 'day.date', 'max(0.0, 12.0 - day.scheduled_hours)'),
		ceiling('OVERTIME_MONTHLY_CAP', month, '104.0')
	],
	// PP 35/2021: rest days and holidays are outside these ordinary-day limits.
	ID: [
		ceiling(
			'OVERTIME_DAILY_CAP',
			'day.date',
			'4.0',
			ordinaryId,
			`${ordinaryId} ? ${approved} : 0.0`
		),
		ceiling(
			'OVERTIME_WEEKLY_CAP',
			'add_days(day.date, -6)',
			'18.0',
			ordinaryId,
			`${ordinaryId} ? ${approved} : 0.0`
		)
	],
	// Ministerial Regulation No. 3: a fixed Monday-to-Sunday week, not a rolling seven-day window.
	TH: [
		ceiling(
			'OVERTIME_WEEKLY_CAP',
			'add_days(day.date, 0 - ((int(calendar_distance_days("2024-01-01", day.date)) % 7 + 7) % 7))',
			'36.0',
			'!(has(terms.facts.continuous_work) && terms.facts.continuous_work == true)'
		)
	],
	VN: [
		ceiling(
			'OVERTIME_DAILY_CAP',
			'day.date',
			'0.5 * day.scheduled_hours',
			'!(has(terms.facts.normal_hours_arrangement) && terms.facts.normal_hours_arrangement == "WEEKLY") && day.scheduled_hours > 0.0'
		),
		ceiling(
			'OVERTIME_DAILY_WEEKLY_ARRANGEMENT_CAP',
			'day.date',
			'max(0.0, 12.0 - day.scheduled_hours)',
			'has(terms.facts.normal_hours_arrangement) && terms.facts.normal_hours_arrangement == "WEEKLY"'
		),
		ceiling('OVERTIME_MONTHLY_CAP', month, '40.0'),
		ceiling(
			'OVERTIME_ANNUAL_CAP',
			year,
			'(has(company.facts.overtime_300h_sector) && company.facts.overtime_300h_sector == true) ? 300.0 : 200.0',
			'day.day_type in ["WORK", "REST", "OFF"] || day.holiday_kind in ["PUBLIC_HOLIDAY", "SUBSTITUTE"]',
			`(day.day_type in ["WORK", "REST", "OFF"] || day.holiday_kind in ["PUBLIC_HOLIDAY", "SUBSTITUTE"]) ? ${approved} : 0.0`
		)
	],
	// Labor Code (PD 442) arts. 83, 87 and 89 price and permit work beyond eight hours without any numeric
	// ceiling, and no DOLE issuance caps adult private-sector overtime (DOLE Advisory 02-04's 12-hour day
	// bounds compressed-workweek normal hours, not overtime). No official limit, so no incentive overflow.
	PH: [],
	// Comprehensive-cycle normal-hour baselines and flexible-time pricing are not overtime ceilings.
	CN: [
		ceiling(
			'OVERTIME_DAILY_LIMIT',
			'day.date',
			'3.0',
			`${standardCn} && (${ordinaryCn})`,
			`(${ordinaryCn}) ? ${approved} : 0.0`
		),
		ceiling('OVERTIME_MONTHLY_LIMIT', month, '36.0', standardCn)
	],
	TW: [
		ceiling('OVERTIME_DAILY_CAP', 'day.date', 'max(0.0, 12.0 - day.scheduled_hours)', coveredTw),
		ceiling(
			'OVERTIME_MONTHLY_CAP',
			month,
			`${extendedTw} ? 54.0 : 46.0`,
			`${coveredTw} && (day.day_type != "REST" || ${holidayTw})`,
			`(day.day_type != "REST" || ${holidayTw}) ? ${approved} : 0.0`
		),
		ceiling(
			'OVERTIME_QUARTER_CAP',
			'month_start(add_months(day.date, -2))',
			'138.0',
			`${coveredTw} && ${extendedTw}`
		)
	],
	JP: [
		ceiling(
			'OVERTIME_MONTHLY_45H',
			month,
			'45.0',
			`${coveredJp} && day.day_type != "REST"`,
			`day.day_type != "REST" ? ${approved} : 0.0`
		),
		// The original >=100 warning remains strict; classification does not invent an epsilon.
		ceiling('OVERTIME_REST_DAY_100H', month, '100.0', coveredJp),
		ceiling('OVERTIME_YEAR_360H', agreementYearJp, '360.0', `${coveredJp} && ${limitedSectorJp}`),
		ceiling(
			'OVERTIME_YEAR_720H',
			agreementYearJp,
			'(has(company.facts.overtime_sector) ? company.facts.overtime_sector : "GENERAL") in ["DRIVER", "DOCTOR_A"] ? 960.0 : (has(company.facts.overtime_sector) ? company.facts.overtime_sector : "GENERAL") == "DOCTOR_BC" ? 1860.0 : 720.0',
			`${coveredJp} && ${limitedSectorJp}`
		),
		...[2, 3, 4, 5, 6].map((months) =>
			ceiling(
				`OVERTIME_AVERAGE_80H_${months}_MONTHS`,
				`month_start(add_months(day.date, ${1 - months}))`,
				`${80 * months}.0`,
				`${coveredJp} && ${generalSectorJp} && !(has(company.facts.disaster_recovery_work) && company.facts.disaster_recovery_work == true)`
			)
		),
		ceiling(
			'CHILDCARE_CARE_MONTHLY_LIMIT',
			month,
			'24.0',
			'has(terms.facts.childcare_overtime_limit_requested) && terms.facts.childcare_overtime_limit_requested == true'
		),
		ceiling(
			'CHILDCARE_CARE_ANNUAL_LIMIT',
			year,
			'150.0',
			'has(terms.facts.childcare_overtime_limit_requested) && terms.facts.childcare_overtime_limit_requested == true'
		),
		ceiling(
			'ROSTER_HAZARDOUS_OVERTIME',
			'day.date',
			'max(0.0, 10.0 - day.scheduled_hours)',
			'has(terms.facts.hazardous_work) && terms.facts.hazardous_work == true'
		)
	]
};

/** Where each lineage's ceilings come from; approved hours past them are paid as incentive, never as overtime. */
const authorities: Record<string, string> = {
	SG: 'Employment Act 1968 s.38(5) and the Employment (Overtime) Regulations: a Part 4 employee works at most 72 overtime hours a calendar month and 12 hours a day.',
	MY: 'Employment Act 1955 s.60A(1) and (3) and the Employment (Limitation of Overtime Work) Regulations 1980: at most 104 overtime hours a month and 12 hours a day.',
	ID: 'PP 35/2021 art.26(1)(b): ordinary-day overtime at most 4 hours a day and 18 hours a week; rest days and public holidays fall outside these limits.',
	TH: 'Labour Protection Act s.26 and Ministerial Regulation No. 3 (B.E. 2541) cl.3: overtime and holiday overtime at most 36 hours a Monday-to-Sunday week.',
	VN: 'Labour Code 2019 art.107(2) and Decree 145/2020 art.60: overtime at most 50% of the normal day (12 hours under a weekly arrangement), 40 hours a month and 200 or 300 hours a year.',
	PH: 'Labor Code (PD 442) arts.83, 87 and 89 set no numeric ceiling on adult overtime and no DOLE issuance adds one, so no hours are classified as incentive.',
	CN: 'Labour Law art.41: extended working hours at most 3 hours a day and 36 hours a month under the standard working-hour system.',
	TW: 'Labor Standards Act art.32(2): total hours at most 12 a day and overtime at most 46 a month, or 54 a month and 138 in three months under a recorded extension.',
	JP: 'Labour Standards Act art.36(4)–(6) and the Child Care and Family Care Leave Act art.17: the 45-hour month, the 100-hour and 80-hour averages, the 360/720-hour years and requested care limits.'
};

/** A version-owned source rule, also copied for each explicitly cloned settings row. */
export function overtimeRule(
	settings: Record<string, Schema.Json>
): Record<string, Schema.Json> | null {
	const lineage = settings['jurisdiction_code'];
	if (!Predicate.isString(lineage)) return null;
	const limits = Object.hasOwn(policies, lineage) ? policies[lineage] : undefined;
	if (limits === undefined) return null;
	const settingsId = settings['id'];
	if (!Predicate.isString(settingsId))
		throw new Error('Overtime policy requires its settings UUID.');
	const hash = createHash('sha256')
		.update(`norbital_hr:overtime_classification:${settingsId}`)
		.digest('hex');
	return {
		id: `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`,
		settings_id: settingsId,
		family: 'PAYROLL',
		scope: 'JURISDICTION',
		code: 'overtime_classification',
		name: 'Overtime classification',
		rules: { authority: authorities[lineage] ?? '', limits: limits.map((limit) => ({ ...limit })) }
	};
}

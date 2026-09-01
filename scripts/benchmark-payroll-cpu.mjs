/**
 * Pure guest-CPU benchmark for a 290-person prepared payroll run.
 *
 * The parent process owns repetition and reporting. Fresh child processes supply cold samples; one
 * additional child performs untimed warmups and then the warm samples. The only timed operation is
 * the synchronous `buildPayrollRun(prepared)` call. Source-module loading, fixture creation,
 * process spawning, JSON, validation and reporting are outside the measurement boundary.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

const scriptPath = fileURLToPath(import.meta.url);
const root = path.dirname(path.dirname(scriptPath));
const sourceResolverPath = path.join(root, 'scripts', 'ts-source-resolve.mjs');

/** Node owns flag spelling, `--name=value`, repeats and unknown-option rejection. */
const { values: flags } = parseArgs({
	options: {
		worker: { type: 'boolean' },
		samples: { type: 'string' },
		warmups: { type: 'string' },
		cold: { type: 'string' },
		warm: { type: 'string' }
	}
});

function integerArgument(name, fallback, { allowZero = false } = {}) {
	const raw = flags[name];
	if (raw == null) return fallback;
	const value = Number(raw);
	const minimum = allowZero ? 0 : 1;
	if (!Number.isInteger(value) || value < minimum || value > 10_000)
		throw new Error(`--${name} must be an integer from ${minimum} to 10000.`);
	return value;
}

function cpuSample(buildPayrollRun, prepared, expectedPayslips) {
	const before = process.cpuUsage();
	const result = buildPayrollRun(prepared);
	const elapsed = process.cpuUsage(before);
	if (
		result.payslipCount !== expectedPayslips ||
		result.payslip_payroll_run.length !== expectedPayslips
	)
		throw new Error(
			`Fixture expected ${expectedPayslips} payslips but the engine returned ${result.payslipCount}.`
		);
	return {
		cpuMillis: Number(((elapsed.user + elapsed.system) / 1000).toFixed(3)),
		userCpuMillis: Number((elapsed.user / 1000).toFixed(3)),
		systemCpuMillis: Number((elapsed.system / 1000).toFixed(3))
	};
}

async function worker() {
	const samples = integerArgument('samples', 1);
	const warmups = integerArgument('warmups', 0, { allowZero: true });
	const [engine, fixtureModule] = await Promise.all([
		import('../src/collections/payroll_runs/lib/engine.ts'),
		import('../src/collections/payroll_runs/benchmark-fixture.ts')
	]);
	const fixture = fixtureModule.PAYROLL_CPU_BENCHMARK_FIXTURE;
	const prepared = fixtureModule.makePayrollCpuBenchmarkPreparedRun();
	for (let index = 0; index < warmups; index += 1)
		cpuSample(engine.buildPayrollRun, prepared, fixture.employeeCount);
	const measured = Array.from({ length: samples }, () =>
		cpuSample(engine.buildPayrollRun, prepared, fixture.employeeCount)
	);
	process.stdout.write(
		JSON.stringify({
			fixture,
			calculationVersion: engine.CALCULATION_VERSION,
			measured
		})
	);
}

/**
 * The worker's stdout contract: the fixture identity, the engine version, and the measured samples.
 *
 * A worker that printed anything else fails here, where the process it came from is still named,
 * rather than reappearing as `undefined` inside a percentile several summaries later.
 */
function validateWorkerReport(value) {
	if (typeof value?.fixture?.id !== 'string' || typeof value.calculationVersion !== 'string')
		throw new Error('Benchmark worker printed no fixture identity or calculation version.');
	if (
		!Array.isArray(value.measured) ||
		value.measured.length === 0 ||
		value.measured.some((sample) => typeof sample?.cpuMillis !== 'number')
	)
		throw new Error('Benchmark worker printed no numeric CPU samples.');
	return value;
}

function runWorker(samples, warmups) {
	const result = spawnSync(
		process.execPath,
		[
			'--experimental-strip-types',
			'--import',
			sourceResolverPath,
			scriptPath,
			'--worker',
			`--samples=${samples}`,
			`--warmups=${warmups}`
		],
		{ cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
	);
	if (result.status !== 0)
		throw new Error(
			`Benchmark worker exited ${result.status ?? 'without a status'}:\n${result.stderr || result.stdout}`
		);
	return validateWorkerReport(JSON.parse(result.stdout));
}

function percentile(sorted, fraction) {
	return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function summary(samples) {
	const values = samples.map((sample) => sample.cpuMillis).toSorted((left, right) => left - right);
	return {
		unit: 'cpu-milliseconds',
		repetitions: values.length,
		p50: percentile(values, 0.5),
		p95: percentile(values, 0.95),
		min: values[0],
		max: values.at(-1),
		samples
	};
}

function coordinator() {
	const coldRepetitions = integerArgument('cold', 5);
	const warmRepetitions = integerArgument('warm', 30);
	const warmupRepetitions = integerArgument('warmups', 5, { allowZero: true });
	const coldWorkers = Array.from({ length: coldRepetitions }, () => runWorker(1, 0));
	const warmWorker = runWorker(warmRepetitions, warmupRepetitions);
	const first = coldWorkers[0];
	for (const candidate of [...coldWorkers.slice(1), warmWorker]) {
		if (
			candidate.fixture.id !== first.fixture.id ||
			candidate.calculationVersion !== first.calculationVersion
		)
			throw new Error('Benchmark workers did not load the same fixture and engine identity.');
	}
	const report = {
		benchmark: 'hr-payroll-prepared-run-guest-cpu',
		fixture: first.fixture,
		calculationVersion: first.calculationVersion,
		measurementBoundary:
			'process.cpuUsage around synchronous buildPayrollRun(prepared); PreparedRun construction and all host I/O excluded',
		runtime: {
			node: process.version,
			platform: process.platform,
			arch: process.arch,
			cpu: os.cpus()[0]?.model ?? 'unknown'
		},
		repetitions: {
			cold: coldRepetitions,
			warm: warmRepetitions,
			untimedWarmups: warmupRepetitions
		},
		cold: summary(coldWorkers.flatMap((entry) => entry.measured)),
		warm: summary(warmWorker.measured)
	};
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

// repository-health:allow EFF3 -- The worker awaits source-module loading before any timed sample;
// the measured payroll engine call itself is synchronous and isolated inside cpuSample.
if (flags.worker === true) await worker();
else coordinator();

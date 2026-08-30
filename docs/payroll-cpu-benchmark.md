# Payroll guest-CPU benchmark

`scripts/benchmark-payroll-cpu.mjs` measures the pure payroll calculation after its database reads
have completed. Its committed fixture contains 290 synthetic monthly employments and identifies
itself as `hr-payroll:my-monthly-basic-epf-pcb:2026-04:290:v1`. It uses the real payroll engine,
calendar resolver and plain settlement policy; it does not copy payroll calculation logic.

From `templates/hr-payroll`, with the template dependencies already installed, run:

```bash
node scripts/benchmark-payroll-cpu.mjs --cold=5 --warm=30 --warmups=5
```

The command emits JSON with the fixture and calculation-version identities, Node/CPU metadata, raw
CPU-millisecond samples, and nearest-rank p50/p95 summaries. A cold repetition is the first timed
build in a fresh Node/V8 process. Warm samples run in one process after the requested number of
untimed builds. Use the same Node version, CPU allocation and repetition counts when comparing two
commits; do not compare results from a busy or differently constrained guest.

The exact timed boundary is `process.cpuUsage()` immediately before and after the synchronous
`buildPayrollRun(prepared)` call. The prepared fixture is constructed before timing. Database and
runtime RPC, source-module loading, child-process startup, fixture construction, result validation,
serialization and console output are therefore excluded. CPU time is reported, not wall-clock
latency, and the runner does not change or enforce a production compute budget. Workers use the
same `scripts/ts-source-resolve.mjs` source loader as the template's existing Node tests; no dev
server or file watcher is alive during a sample.

The committed 2026-08-30 receipt is
[`payroll-cpu-benchmark-2026-08-30.json`](payroll-cpu-benchmark-2026-08-30.json). On Node 26.0.0
and an Apple M5 Pro it records cold p50/p95 of 120.325/127.2 CPU-ms and warm p50/p95 of
56.034/65.435 CPU-ms for all 290 payslips. Those figures certify the named machine and fixture;
they are not a portable production budget.

Prerequisites are a Node release that supports `--experimental-strip-types` and this template's
already-installed runtime dependencies (`effect`, `@norbital-ai/bolt`, and `@norbital-ai/std`). The
runner deliberately does not install, build, sync or write generated artifacts.

# ADR-001 — Desktop Runtime

## Status

ACCEPTED for the current Windows HTTP-only DRY_RUN desktop. Date: 2026-09-07; accepted after final M4.5 evidence review on 2026-09-09 (local date). Actual packaged workflow, SQLite, graceful shutdown/restart and resources are demonstrated. Security acceptance uses verified shipped/source configuration and passing tests per the user's final instruction; the automated smoke limitation is recorded below.

## Context

The product is Windows-first with asynchronous store I/O, possible Playwright browser work, local persistence, and a modern desktop UI. Runtime choice affects IPC, installation, browser distribution, native modules, updates and memory. An empty-window comparison would omit most of this workload.

## Decision

Use Electron with TypeScript, a local React renderer, a narrow preload/main bridge, a Node background coordinator and bounded adapter I/O worker. Keep business code runtime-independent and forbid renderer imports of store/persistence modules. Final M4.5 evidence satisfies the applicable HTTP-only packaged operation and process-tree resource portions of Roadmap S1. This does not qualify future browser automation, sessions/secrets, commercial updates or purchase capabilities.

## Alternatives Considered

* Tauri with React and a Node sidecar preserves TS automation and may reduce UI-host footprint, but adds Rust/sidecar packaging, lifecycle and IPC coordination.
* Tauri with a Rust core avoids some sidecar overhead but changes the team skill requirement and automation path substantially.
* .NET Windows UI and core offers a credible native route for a .NET team, without a demonstrated advantage for this TS-oriented workload.

Electron's [utility process](https://www.electronjs.org/docs/latest/api/utility-process) and Tauri's [Node sidecar](https://v2.tauri.app/learn/sidecar-nodejs/) support the basic alternatives. Performance preference is an inference to test.

## Consequences

Electron maximizes initial developer velocity for this product while accepting potentially higher memory/download cost. UI engine, Playwright browser and SQLite native driver must be packaged and patched as a coherent supported set. Process boundaries improve responsiveness but do not sandbox privileged Node code. UI framework choice remains replaceable; core contracts do not include Electron APIs.

## Risks

Native driver ABI mismatch, browser executable distribution, process cleanup failures, security configuration mistakes and unacceptable footprint. S1 must include standard-user installation, restart and shutdown, no public debugging interface and a comparable workload if Tauri is evaluated. No runtime/framework initialization is authorized by this ADR itself.

## Future Impact and Migration Cost

HIGH: approximately 1–3 engineer-months after product growth for host/preload, packaging, updates and automation integration. Domain algorithms and repository contracts should survive; renderer reuse is possible but not guaranteed. Before implementation, switching is much cheaper. Reopen if measured footprint or packaging requirements fail, or the team becomes predominantly Rust/.NET.

## M4 packaged experiment — 2026-09-09

A Windows x64 portable archive was built, extracted and verified byte-for-byte: 162,912,326 bytes compressed; 385,698,982 bytes installed. It bundles Electron 44.3.0 / Chromium 152.0.7977.78 / Node 24.20.0. Its utility coordinator opened SQLite 3.53.4, created schema 3 and persisted a fixture observation, BLOCKED simulation, audit/outbox and receipt using the existing repositories. No native SQLite addon or second database layer was needed.

The extracted application was launched without Node/pnpm in PATH and with a non-administrator token. Main started, but renderer loading failed. GPU child processes exited with `0xC0000135` (DLL-not-found status); hardware and software-rendering experiments both failed. The specific missing dependency or host restriction is not identified. Default AppData creation was denied in this execution host even after the requested path permission was granted, so SQLite experiments used an explicit workspace profile. Renderer sandboxing was retained throughout.

At this historical stage, Windows qualification remained open. The observed 201.2 MiB failed-startup sample is not an idle benchmark and cannot satisfy the provisional 500 MiB gate. The failures did not establish that Electron was unsuitable on ordinary Windows installations or justify switching runtimes.

## Earlier basic target-Windows validation — historical

The user manually launched the packaged application on the target Windows machine. Electron opened, React loaded, the dashboard was visible and interactive, sidebar navigation and store health rendered, SQLite initialized with visible footer status, and the DRY_RUN banner remained visible. No immediate renderer crash occurred. Microsoft Visual C++ x64 runtime was installed (`Installed: 1`, `Version: v14.50.35719.00`). This is accepted as real target-machine evidence; see `outputs/M4_USER_WINDOWS_VALIDATION.json` and `outputs/M4_REPORT.md`.

The earlier GPU/renderer failure is therefore environment-specific and was not reproduced on the target machine. It is not a package-wide launch failure or a reason to reject Electron. The installed Visual C++ runtime is environment context, not proof of the earlier failure's root cause or of a minimum supported runtime version. No real mutation capability was added; existing security configuration, deterministic tests and visible DRY_RUN remain in force.

At that earlier basic-smoke stage the ADR remained EXPERIMENT_REQUIRED because lifecycle/resources and the full workflow were not yet reported. That assessment is superseded by the final M4.5 acceptance below.

## Final M4.5 acceptance — 2026-09-09

**ACCEPTED.** The user completed the real target-Windows packaged workflow: Electron/React/Dashboard and prominent DRY_RUN; authorized Kantocards URL observation at 95.00 MXN; HEALTHY store, seller APPROVED, truthful UNKNOWN costs/stock and INELIGIBLE / Simulation Blocked; visible durable history; pause/resume and persisted close/reopen. Host authorization works with the two approved environment variables and safely shows NETWORK NOT ENABLED without them while retaining data. No real mutation occurs.

Independent read-only inspection still matches all 79 production files and finds schema 3, integrity OK, four observations/evaluations with one stable product/variant/offer, one BLOCKED intent, four audits, one delivered outbox/receipt and zero checkout attempts. All 224 deterministic tests, strict build/typecheck, boundary lint and formatting pass again. Existing production/test packaging builds pass.

Five-process topology: 1 main, 1 GPU, 1 renderer, 2 utilities. Idle working set/private memory approximately 367.5 / 218.4 MB; during/after observation 381.1 / 251.8 MB. No runaway process growth. Idle memory meets the provisional 500 MB total-idle target. Idle CPU is 0.0625 CPU-seconds over 10 seconds, or 0.625% of one logical core. User-reported cold/warm process launch is 30.7648 / 11.1073 ms; graceful shutdown is 102.5134 ms. Process-launch timings are not time to interactive UI, and no exact peak or large-workload claim is made.

The user's final instruction explicitly accepts source/configuration/test evidence for isolation, sandbox, DevTools, CSP and navigation. Review of the actual shipped ASAR verifies the preferences wired into BrowserWindow, CSP delivered on local responses, denied popup/navigation/webview handlers, validated external links and the narrow preload; all 14 inspection checks pass. Existing IPC/URL/renderer/escaping tests and no-TCP-listener snapshots support that evidence. No critical implemented security-boundary violation was established.

The automated smoke also fails on the target under its automated launch context (GPU child 0xC0000135, OS crypt 0x2, renderer stops/load failure), while manual production operation works there. The harness uses a separate fixture entry/package, fresh profile, restricted PATH and hidden launch. This supports a **non-blocking automated-launch environment/harness limitation** classification; which difference causes it is unproven. The smoke is not relabelled PASS and its dynamic Chromium assertions remain unexecuted. This replaces the earlier requirement for a successful smoke with the user's explicitly approved alternative security evidence; no safeguard was disabled.

No critical M4 gate remains under that evidence basis. Diagnose the harness and improve dynamic/interactive timing coverage as follow-up, not as a claim of completed testing. Reopen this ADR if production operation becomes unstable, footprint exceeds the target under intended workload, or new browser/native/security requirements invalidate the evidence. Other experimental ADRs remain unchanged.

Evidence: [M4.5 report](../../outputs/M4_5_REPORT.md), [final user evidence](../../outputs/M4_5_FINAL_USER_EVIDENCE.json), [shipped security review](../../outputs/M4_5_FINAL_SECURITY_REVIEW.json), [package/database verification](../../outputs/M4_5_FINAL_PACKAGE_DATABASE.json), [final tests](../../outputs/M4_5_FINAL_VALIDATION_LOG.txt). **M4 PASS; READY FOR NEXT PHASE. No subsequent phase was started.**

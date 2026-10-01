# Connect an existing QA bot

The outbound connector links a **separate trusted `qa-signoff-bot` checkout** to one PatchSentry project. It uploads report summaries, advertises explicitly configured local models, and can apply your website's model selections. Default mode only synchronizes reports. Explicitly enrolled execution mode also claims website jobs and launches the reviewed QA engine on your runner. It never changes product files, commits, pushes, merges, starts model servers, or calls GitHub.

Use Node.js 22.17 or newer. The connector has no additional runtime dependencies. Run it from this website repository, or copy both `scripts/agent.mjs` and `scripts/runner.mjs` to your trusted agent machine. The bot must include `src/ai/settings.js` and support OpenRouter/local settings.

## Enroll the agent

1. Create a website account and a project whose repository is the product's exact `owner/repository`.
2. Create a project agent token in the project settings. Store it in your CI secret store or local process environment, alongside the portal's HTTPS origin. Do not put tokens in shell arguments, commit them, or save them in the bot configuration.
3. Point the connector at the bot checkout and the existing bot state file. Config and state paths are resolved inside that checkout; escaping paths and symlinks outside it are rejected.

```sh
export QA_PORTAL_URL='https://your-patchsentry-deployment.example'
# Set QA_PORTAL_TOKEN using your secret manager or a hidden shell prompt.
node scripts/agent.mjs --bot-dir /path/to/qa-signoff-bot
```

By default the connector reads `qa-config.json` and `.qa-local/state.json` beneath `--bot-dir`. It uploads summaries only for the repository bound to the token. A missing state file produces a heartbeat with zero reports. A successful heartbeat records a real agent connection on the website; it does not assert that tests or a model have run.

For an alternate exported state file inside the bot checkout:

```sh
node scripts/agent.mjs --bot-dir /path/to/qa-signoff-bot \
  --state .qa-local/exported-state.json --config qa-config.json
```

For GitHub-backed state, first export the bot's state from its own `qa-state` branch into an agent-owned location inside the bot checkout. The connector does not fetch GitHub data or need a GitHub token. Do not point it at a product repository or place exported state in the product checkout.

Watch mode polls every 30 seconds. `--interval` accepts 30–3600 seconds. Ctrl-C or SIGTERM stops polling.

```sh
node scripts/agent.mjs --bot-dir /path/to/qa-signoff-bot --watch
```

Default sync writes **no local files**. A stable record ID identifies each QA attempt; updates use idempotent `PUT` requests. Unchanged reports are skipped in the same watch process. Restarting may resend the same report safely. A failed upload is retried on the next poll and does not change the bot's QA outcome. Poll failures are reported without response bodies or credentials.

## Request and execute QA from the website

Execution is an explicit local enrollment, separate from report sync. The website does not provision a VM, browser farm, model server, physical phone, or product preview. Configure these on a trusted machine first:

1. Keep the QA bot and product in separate checkouts. The product checkout needs the requested full commit and locally trusted base reference already available. Fetch commits through your trusted setup; a website job cannot choose a remote or run `git fetch`.
2. Configure the bot's `qa-config.json` with an enabled AI backend, compatible selected model, source exclusions, and budgets. Keep provider keys in the runner environment. Start your local model server if selected.
3. Install each browser engine you will enroll, or point `QA_CHROMIUM_EXECUTABLE`, `QA_FIREFOX_EXECUTABLE`, and `QA_WEBKIT_EXECUTABLE` at installed executables. Browser binaries are not downloaded by a website job. For isolated baseline suites, locally configure the bot's reviewed runners, Docker, and prebuilt images.
4. Deploy a disposable product preview exposing exact commit identity as required by the QA engine. Set a testing profile in the website with its URL, initial pages, browser matrix, and explicit user goals/expected text or URL. Supply synthetic inputs only. A code review or healthy HTTP response cannot establish the preview revision.
5. Create `portal-policy.json` **inside the bot checkout**. This example disables preview mutations, visual comparison, semantic maintenance, and baseline execution until locally enrolled:

```json
{
  "schemaVersion": 1,
  "repository": "your-org/your-product",
  "repoCheckout": "/absolute/path/to/product",
  "base": "main",
  "allowedPreviewOrigins": ["https://pr-{pr}.preview.example"],
  "allowedBrowsers": ["chromium"],
  "allowedBackends": ["local"],
  "maxPages": 4,
  "maxGoals": 8,
  "maxAssertions": 30,
  "maxCostUsd": 2,
  "maxCallsPerRun": 20,
  "allowImages": false,
  "allowMutations": false,
  "allowSemanticMaintenance": false,
  "executeBaseline": false,
  "timeoutMs": 900000,
  "configPath": "qa-config.json",
  "regressionDir": ".qa-regressions"
}
```

Origins must be exact; `{pr}` may appear in an enrolled hostname. Enroll only disposable authorized previews. The website cannot broaden this allowlist, change the checkout, run arbitrary commands, or increase local caps. `base` must match the testing profile's base. `regressionDir` and all outputs must remain outside the product checkout. The trusted bridge validates these boundaries again before execution.

```sh
# Local checks only: no model, preview, or portal request.
node scripts/agent.mjs --bot-dir /path/to/QA-testbot --execute-jobs --runner-policy portal-policy.json --check-runner

# After the prerequisite check reports ready:
node scripts/agent.mjs --bot-dir /path/to/QA-testbot --watch --execute-jobs --runner-policy portal-policy.json
```

Keep `QA_PORTAL_URL` and `QA_PORTAL_TOKEN` in the connector environment. Readiness checks inspect trusted configuration, the local checkout/base and installed browser executables. They do not prove a model endpoint, deployment, Docker image, or device will be available at execution time; missing runtime prerequisites remain blocked. A heartbeat is online for 90 seconds. Execution watch mode polls every 30–60 seconds; local preflight exits with code 2 when enrollment is not ready. Run only one execution connector per project token; enrollment status is project scoped.

In **Models & agents**, save the models to use. In **Testing setup**, save the preview profile and trusted assertions. In **Overview** or **PR reports**, enter the PR number and **full 40-character commit SHA**, then choose **Request QA run**. The website persists an immutable snapshot of repository, SHA, settings and profile. Missing setup creates a visible blocked request. After changing a profile or model selection, request a new job; existing inputs do not change.

The connector claims one job, invokes only `node <trusted-bot>/src/autonomy/portal.js --job ... --policy ... --output-dir ...` using an argument array without a shell, and uploads a validated `portal-run.json`. The subprocess receives inference keys and approved runtime variables, but never the portal token, website database/auth secrets, or GitHub token. The bridge retains regression evidence on the runner. Execution finishing does not mean QA passed: failed, missing, or blocked checks retain those outcomes.

Leases last five minutes and renew every 30 seconds along with heartbeats. A lost lease or cancelled job stops the child process. Expired jobs become **blocked**, not silently rerun. After checking local evidence, choose **Retry explicitly**; the same job has at most three attempts. A valid completed local report is reused without launching models or browsers again. Incomplete work may have spent budget already; engine checkpoints and cumulative limits remain authoritative. Queues allow 20 active jobs and 1,000 stored jobs per project; the UI lists the latest 100. Request IDs deduplicate retries, and completion ACKs require a matching uploaded repository/PR/SHA.

For synthetic signup, login or checkout, both the website profile and local policy must set `allowMutations: true`. For retained journey maintenance, both must enable `allowSemanticMaintenance` (inside `testingProfile.goals` on the website); trusted assertions remain required outcomes. Locally set `executeBaseline: true` only after configuring isolated baseline suites and prerequisites. No website field can enable baseline commands directly.

For visual comparison, locally enroll `visual` with `baselineDir`, `pixelThreshold`, `maxDiffRatio`, and `maxSnapshots`, then enable **Compare screenshots** in Testing setup. Follow the engine's baseline acceptance workflow once for reviewed reference images. Missing or changed baselines block/fail comparison; the website cannot accept them automatically. Browser-engine testing is not physical mobile-device coverage; native-device infrastructure is separately provisioned.

## Apply website model settings

Saving project settings on the website alone does not alter a machine. Opt in on the agent:

```sh
node scripts/agent.mjs --bot-dir /path/to/qa-signoff-bot \
  --watch --apply-model-settings
```

This imports the **trusted bot's own** `validateAIConfig` function, validates the selection, and atomically updates only the chosen bot JSON configuration. Run it only with a bot checkout you trust. It preserves bot activation, local server address and profiles, provider privacy settings, source filters, output/context limits, required review, test runners, execution images, and repository settings. The website cannot provide executable commands, source paths, endpoint addresses, or keys.

The current inference backend is the only enrolled backend by default. To let the website switch between local inference and OpenRouter, explicitly enroll both:

```sh
node scripts/agent.mjs --bot-dir /path/to/qa-signoff-bot \
  --watch --apply-model-settings --allow-backends openrouter,local
```

Cross-backend enrollment matters: switching to OpenRouter allows the QA bot to send its permitted source context to an external inference provider. The connector itself never sends source context to the portal. Website updates also cannot turn on screenshot sharing unless it was already enabled locally or the connector was started with `--allow-images`.

The applied `maxCostUsd` and `maxCallsPerRun` are each the smaller of the website setting and the existing local limit. Remote updates cannot raise either limit. Once a remote update lowers the saved local limit, raising it again requires a deliberate local configuration edit. The website displays requested settings; the bot's saved configuration is authoritative for effective limits.

The connector does **not** enable a disabled bot or AI layer. Enable and configure the bot locally after selecting a compatible model. Model changes affect subsequent bot runs, not already running jobs. For a one-shot workflow, run the connector with `--apply-model-settings` before invoking the existing QA job, then run the connector again after the job saves its state.

OpenRouter needs `OPENROUTER_API_KEY` in the QA bot process environment. A local server may use `LOCAL_MODEL_API_KEY`. Neither key is collected by the portal or sent by this connector. `QA_PORTAL_TOKEN` grants access only to the enrolled project's connector endpoints; it is not an inference key.

Local model choices come from the bot's explicit `ai.local.models` profiles, for example:

```json
{
  "id": "qwen3:8b",
  "contextLength": 16384,
  "tools": true,
  "vision": false
}
```

Use the ID and actual context size supported by your server. This example is a profile format, not a claim that a particular model is installed or suitable. The connector sends only model IDs, names, context sizes, and declared tool/vision support. It does not scan the machine, query model endpoints, download weights, install models, or verify those declarations. The QA bot validates compatibility before use. Local inference still consumes hardware, memory, electricity, and possibly hosting fees; these costs are not reported as provider charges.

## Shared data and limits

Native journeys are configured in the trusted bot, using its [native adapter](https://github.com/Vaidehi2510/QA-testbot/blob/main/docs/native-qa.md). They require a separately provisioned disposable device or VM and local `QA_NATIVE_ENABLED=true` / `QA_NATIVE_DEVICE_ID` enrollment. The connector forwards these two local gates to the fixed execution bridge; website settings cannot set them. A configured native baseline can run when the local policy permits baseline execution. The website preview workflow still requires a browser preview and trusted browser goals; it does not provision devices or provide a native journey editor.

Uploads contain the repository identifier, PR number/title, commit SHA, timestamps, attempt identity, planned check names/methods/required flags/statuses, unverified finding summaries and relative file names, suggested fixes, model identifiers, cumulative usage cost/call count, and limitations. Planning and completion findings are combined; cumulative costs are counted once. Historical runs that did not record their inference backend are labeled `unknown`.

Source files, patches, screenshot pixels, test log/evidence excerpts, rendered Markdown reports, proposed test source, raw configuration, prompts, and model transcripts are excluded by an explicit field allowlist. Code fences, inline code, Markdown quotations, indented code, common credential formats, and URLs are removed from free-text summaries. **This is best-effort redaction, not a guarantee that summaries contain no sensitive information.** Prose, PR titles, paths, check names, model IDs, and unformatted code can still reveal product details. Use the portal only for projects authorized to share this metadata and narrative information.

Reports are limited to 256 KiB, 200 complete checks, and 100 highest-severity findings. Long finding text may be shortened. A plan exceeding the check limit is skipped rather than reporting a misleading partial denominator. Invalid or duplicate results never become passes. Run history snapshots preserve distinct execution attempts. The website calculates the score from uploaded required checks; an AI review or suggestion does not override a failing executed test.

The state file is limited to 32 MiB and configuration to 256 KiB. Keep local state snapshots bounded as history grows. The connector reads state atomically as a file snapshot; if another process is in the middle of a non-atomic write, an invalid snapshot is rejected and watch mode retries. The supported bot writes state atomically.

Project agent tokens permit config reads, heartbeat updates, leased-job claims/acknowledgements, and report uploads for one project. Someone who steals one can submit false project reports, so protect it like a CI credential. Rotate the token in the website and replace `QA_PORTAL_TOKEN` on each enrolled agent; previous tokens should stop authenticating. Inference keys remain on the QA machine and rotate separately. HTTPS is mandatory, redirects are rejected, and network operations have timeouts and bounded response bodies.

## Offline preview and local development

```sh
node scripts/agent.mjs --bot-dir /path/to/qa-signoff-bot --dry-run
```

Dry-run validates and summarizes local state without network requests, config writes, or execution of the bot validator. It prints counts, not the report contents, and does not need a portal token. It cannot be combined with watch mode.

For a local website only, set `QA_PORTAL_URL=http://127.0.0.1:3000` and pass `--allow-http-loopback`. Only literal `127.0.0.1` and `[::1]` are accepted for this explicit HTTP exception. Other origins require HTTPS. No inbound agent listener, tunnel, product credential, or product code modification is required.

# Connect an existing QA bot

The outbound connector links a **separate trusted `qa-signoff-bot` checkout** to one PatchSentry project. It uploads report summaries, advertises explicitly configured local models, and can apply your website's model selections. It does not run tests, start models, change product files, commit, push, merge, or call GitHub. Keep your existing QA bot workflow or local review process running to produce new results.

Use Node.js 22.17 or newer. The connector has no additional runtime dependencies. Run it from this website repository, or copy `scripts/agent.mjs` to your trusted agent machine. The bot must include `src/ai/settings.js` and support OpenRouter/local settings.

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

Uploads contain the repository identifier, PR number/title, commit SHA, timestamps, attempt identity, planned check names/methods/required flags/statuses, unverified finding summaries and relative file names, suggested fixes, model identifiers, cumulative usage cost/call count, and limitations. Planning and completion findings are combined; cumulative costs are counted once. Historical runs that did not record their inference backend are labeled `unknown`.

Source files, patches, screenshot pixels, test log/evidence excerpts, rendered Markdown reports, proposed test source, raw configuration, prompts, and model transcripts are excluded by an explicit field allowlist. Code fences, inline code, Markdown quotations, indented code, common credential formats, and URLs are removed from free-text summaries. **This is best-effort redaction, not a guarantee that summaries contain no sensitive information.** Prose, PR titles, paths, check names, model IDs, and unformatted code can still reveal product details. Use the portal only for projects authorized to share this metadata and narrative information.

Reports are limited to 256 KiB, 200 complete checks, and 100 highest-severity findings. Long finding text may be shortened. A plan exceeding the check limit is skipped rather than reporting a misleading partial denominator. Invalid or duplicate results never become passes. Run history snapshots preserve distinct execution attempts. The website calculates the score from uploaded required checks; an AI review or suggestion does not override a failing executed test.

The state file is limited to 32 MiB and configuration to 256 KiB. Keep local state snapshots bounded as history grows. The connector reads state atomically as a file snapshot; if another process is in the middle of a non-atomic write, an invalid snapshot is rejected and watch mode retries. The supported bot writes state atomically.

Project agent tokens permit config reads, heartbeat updates, and report uploads for one project. Someone who steals one can submit false project reports, so protect it like a CI credential. Rotate the token in the website and replace `QA_PORTAL_TOKEN` on each enrolled agent; previous tokens should stop authenticating. Inference keys remain on the QA machine and rotate separately. HTTPS is mandatory, redirects are rejected, and network operations have timeouts and bounded response bodies.

## Offline preview and local development

```sh
node scripts/agent.mjs --bot-dir /path/to/qa-signoff-bot --dry-run
```

Dry-run validates and summarizes local state without network requests, config writes, or execution of the bot validator. It prints counts, not the report contents, and does not need a portal token. It cannot be combined with watch mode.

For a local website only, set `QA_PORTAL_URL=http://127.0.0.1:3000` and pass `--allow-http-loopback`. Only literal `127.0.0.1` and `[::1]` are accepted for this explicit HTTP exception. Other origins require HTTPS. No inbound agent listener, tunnel, product credential, or product code modification is required.

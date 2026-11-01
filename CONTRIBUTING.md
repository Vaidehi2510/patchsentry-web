# Contributing to the Patchsentry website

This repository contains Patchsentry's public website and private QA workspace.
Start with the [README](README.md) and [public demonstration](https://patchsentry.vercel.app/demo).
The demonstration uses illustrative reports; those values are not customer results.

## Useful first contributions

Documentation, setup reproduction, keyboard navigation, responsive layout,
accessible labels, understandable error messages and synthetic regression cases
are welcome. Look for a `good first issue`, or describe the issue you noticed and
ask about a focused scope. You do not need a company account or paid model to
contribute to the public UI.

## Repository map

- This repository: account/project UI, APIs, hosted queue and current report store.
- [QA engine](https://github.com/Vaidehi2510/QA-testbot): isolated checks and optional
  AI review; its [no-key quick-start](https://github.com/Vaidehi2510/QA-testbot/blob/main/docs/reviewer-quickstart.md)
  demonstrates actual fixture assertions.
- [Java Ledger](https://github.com/Vaidehi2510/Patchsentry-Ledger-Java): optional
  separate archive service, not required for ordinary website development.

## Local setup and checks

Use Node.js 24 and npm:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:3000/demo` to work on the illustrative workspace without
configuring a model or signing in. For local authenticated development, follow the
README's `.env.example`, random secret, PGlite database and migration instructions.
Use disposable data and your own local settings; do not copy production variables.

For relevant behavior changes:

```sh
npm test
npm run typecheck
npm run build
```

The tests provide synthetic sessions and local PostgreSQL-compatible storage; they
do not require actual verification email, Entra/AWS accounts or paid model calls.
Use a focused existing test while developing; describe its scope in the pull request.
Check UI changes with keyboard navigation and both desktop and narrow viewports.
Actual company-provider validation and production deployment need separate owner
configuration and evidence; a mocked response must stay labeled as such.

Read [AGENTS.md](AGENTS.md) before changing Next.js code, and consult the installed
Next.js guides identified there. Preserve server-side membership, MFA and project
scope checks even when a UI already hides an action. Keep secrets server-only.

## Propose and submit a change

1. Search this repository's issues for related work. For a substantial change,
   describe the problem and proposed scope in an issue before investing much time.
   Small fixes can go straight to a pull request.
2. Fork the repository, create a focused branch, and keep unrelated changes out.
3. Explain the user-visible problem, the resulting behavior and the checks you
   actually ran. If a check was not run, state that and why.
4. Include reproduction steps and synthetic evidence for a bug. For UI changes,
   check keyboard use and a narrow viewport; include a screenshot when useful.
5. Respond to review questions and credit anyone whose work informed the change.

A maintainer reviews scope, behavior and evidence before merging. Review is
best-effort; there is no promised turnaround. Contributors are not expected to
configure paid services or obtain production credentials to propose a change.

## Choose checks that match the change

For wording or policy edits, check links, commands and formatting; a full
application test run is usually unnecessary. For behavior changes, run the relevant
existing tests and add a regression only when it verifies the behavior at risk.
Run the repository's required CI checks before relying on a release. Passing
fixture tests does not prove live-provider interoperability, whole-product test
coverage or staffing savings.

Use synthetic accounts and disposable environments. Never commit `.env` files,
tokens, private repository content, customer reports, screenshots containing real
user data, or production database exports. Do not start paid model/device sessions,
send notifications, or enable production schedules as part of ordinary testing.
The QA bot's product-source access must remain read-only; proposed fixes and tests
must not silently edit, push to or merge a connected product repository.

If an AI tool assisted, briefly describe its role and how you checked the result.
Label mocked model responses and integrations. You are responsible for reviewing
the submitted code and its claims; an automated agent role is not evidence of
participation by another person.

## Community, security and license

Follow the [code of conduct](CODE_OF_CONDUCT.md). Report possible vulnerabilities
using [SECURITY.md](SECURITY.md), rather than a public issue containing an exploit
or sensitive data. General project questions can use a public issue, or
[patchsentry@gmail.com](mailto:patchsentry@gmail.com) when they need to be private.

Contributions are submitted under this repository's [MIT License](LICENSE).
Keep any third-party copyright and license notices with their material. Identify
external code/assets and their source so a maintainer can review compatibility.

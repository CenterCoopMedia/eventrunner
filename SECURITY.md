# Security policy

## Supported versions

Only the **latest tagged release** receives security fixes. Older releases are
not patched; upgrade to the current release before reporting an issue against
older code.

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security problems.

**Primary channel:** use GitHub's private vulnerability reporting — the
"Report a vulnerability" button on the
[Security tab](https://github.com/CenterCoopMedia/eventrunner/security) of this
repository. Reports filed there are visible only to maintainers.

**Fallback:** if you cannot use GitHub's reporting flow, email
info@collaborativejournalism.org with a description of the issue, steps to
reproduce, and the affected version or commit.

<!-- OPERATOR NOTE: before public launch, replace info@collaborativejournalism.org
     with a dedicated security@ alias so vulnerability reports do not land in a
     general-purpose inbox. -->

## What to expect

- **Acknowledgement within 3 business days** of receiving your report.
- We will work with you to confirm the issue, assess impact, and develop a fix.
- **Coordinated disclosure, 90-day default:** we ask that you keep the report
  private for up to 90 days from acknowledgement, or until a fix is released,
  whichever comes first. We are open to adjusting the timeline in either
  direction by mutual agreement.
- We will credit reporters in release notes unless you prefer otherwise.

## Scope

This policy covers the code in this repository.

**Operator-run client deployments are out of scope for public reports.** If
you find an issue specific to a hosted deployment of this platform (its
configuration, data, or infrastructure), report it privately to the operator
of that deployment — not through this repository. Issues in the shared
codebase discovered via a deployment may be reported here through the private
channels above, but do not include client data in the report.

## Dependency audit policy

CI runs `npm audit --omit=dev` on every pull request and fails the build on
any high or critical finding in a production dependency. A finding only
passes when a maintainer has logged it, with a reason, in
[`scripts/ci/audit-exceptions.json`](scripts/ci/audit-exceptions.json). That
file is the running record of every known vulnerability we have chosen not to
fix yet — package, advisory link, severity, exposure, why it is unfixed, and
the date we last reviewed it. Findings in build tools or local dev tooling
(for example the Firebase CLI or Vite) are tracked there too, but they never
fail CI on their own.

## No bounty program

We do not operate a bug bounty and cannot offer monetary rewards for reports.

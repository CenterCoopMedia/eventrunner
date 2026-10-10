# npm names and publication readiness

Operator runbook for issue #99: Evaluate the `eventrunner` / `event-runner` package
names and the matching `@eventrunner` / `@event-runner` scopes.

## Stop before reserving names

Issue #99 originally proposed non-functional placeholder packages and empty
organizations. [npm's name policy](https://docs.npmjs.com/policies/disputes/)
prohibits registering names solely for future use. A package with no genuine
function counts as squatting. An organization with no packages published within
a reasonable time can also count as squatting. Empty placeholders do not meet
this policy, even when the intended project exists elsewhere.

Do not execute the original placeholder plan. Before publication, the maintainer
must approve a revised scope that identifies a useful package, its release
contents, and any organizations needed for active use. This runbook does not
select that package or authorize a release.

**Who runs publication:** A human operator using the intended CCM-controlled npm
user account with 2FA and organization-controlled recovery information. An npm
organization is separate from the user account that logs in. Unattended sessions
can perform the public read-only checks below; publication and organization
creation need the maintainer's explicit final go-ahead in the execution session.

## 1. Check the public registry

Package names and organizations are different registry objects. Record the time,
registry, exit code, and response for each check.

Human operators can use the npm CLI commands below. An installed npm client can
attach saved registry credentials even for read-only requests. Unattended checks
must use the credential-free HTTP commands later in this section.

```sh
npm view eventrunner --registry=https://registry.npmjs.org/
npm view event-runner --registry=https://registry.npmjs.org/
npm org ls eventrunner --registry=https://registry.npmjs.org/
npm org ls event-runner --registry=https://registry.npmjs.org/
```

| Result | What it proves |
| --- | --- |
| Package metadata | A package exists. Check its maintainers before any publication. |
| Package `E404` / `Not found` | The lookup found no package. Publication permission remains unverified. |
| Organization member response | An organization exists. This does not establish CCM control. |
| Organization `E404` / `Scope not found` | The lookup found no organization. Name acceptance remains unverified. |
| Authentication, network, rate-limit, or other error | The check is inconclusive. |

A bare scope, such as `npm view @eventrunner`, is not an organization lookup.
For a public HTTP check, use these endpoints without credentials:

```sh
curl -i https://registry.npmjs.org/eventrunner
curl -i https://registry.npmjs.org/event-runner
curl -i https://registry.npmjs.org/-/org/eventrunner/user
curl -i https://registry.npmjs.org/-/org/event-runner/user
```

A 404 is an observation, not a reservation or a guarantee that npm will accept
the name. If a name exists, stop and confirm its ownership with the maintainer.
Do not infer control from matching names or an empty member response.

## 2. Prepare an approved functional release

- Agree with the maintainer which package has a genuine function and which
  names and organizations are needed. Revise issue #99's placeholder acceptance
  criteria before treating publication as ready. For each proposed organization,
  identify the active package to publish under its scope. Omit organizations
  without an approved active package.
- Review the release files, license, version, README, and package metadata.
  Preview the tarball file list with `npm pack --dry-run --ignore-scripts` from
  the approved package directory. This does not create or test the tarball.
- Review lifecycle scripts and generated build files before approving the final
  release contents. The preview above skips scripts; publishing from a directory
  can run them and produce different contents.
- After approving the build and lifecycle scripts, create the final tarball with
  [`npm pack`](https://docs.npmjs.com/cli/v11/commands/npm-pack/). Inspect its
  actual file contents, including generated files, and check for private data.
  Record its path and SHA-256 checksum with the release approval. Publish that
  exact reviewed tarball; rebuilding or changing it requires another review.
- Confirm the package's behavior with the relevant checks for that release.
- Keep secrets and private files out of the tarball. Do not publish from the
  repository root or remove a workspace's `private` flag to reserve a name.
  The existing root and workspaces are private application packages.

## 3. Confirm the operator account

Run `npm whoami` against the public registry. Confirm the returned user is the
approved operator. On the npm website, verify that user's 2FA, recovery details,
and required organization role. A successful login does not prove those checks.

If login is needed, the human operator completes `npm login` and 2FA. Do not
script around 2FA or store a token that bypasses it.

## 4. Recheck and obtain the final go-ahead

Repeat all four registry checks immediately before any public change. Ask the
maintainer to approve the exact names, reviewed tarball and checksum, and
organization actions in that execution session. Confirm the tarball checksum
still matches. Earlier planning approval is insufficient. Stop if the observed
ownership changed or any prerequisite is unverified.

## 5. Create only the approved organizations and publish

Follow npm's [organization creation instructions](https://docs.npmjs.com/creating-an-organization/)
on the website. Select the free public-package plan unless a paid plan is
separately authorized. Add the approved maintainers and verify their roles.
An organization's name is its scope.
Create an organization only when the approved release includes its active
scoped package. A member roster alone does not satisfy the active-use policy.

The documented [`npm org` command](https://docs.npmjs.com/cli/v11/commands/npm-org/)
manages members with `set`, `rm`, and `ls`; it does not provide `npm org create`.

Publish only the exact reviewed tarball, with the agreed name and access level.
[`npm publish`](https://docs.npmjs.com/cli/v11/commands/npm-publish/) accepts a
local tarball path. Do not publish from the source directory or repack after
approval. Complete 2FA interactively. This runbook provides no publish command
until that release is defined and approved.

## 6. Verify ownership and record the result

- Run `npm view <approved-package-name>` against the public registry and check
  the exact version, description, and maintainers against the approved release.
- Check each approved organization with `npm org ls <org-name>` while signed in
  as the operator, and verify owner and maintainer roles on the npm website.
- For every created organization, verify its approved scoped package exists in
  the registry and is associated with that organization. Record the package URL
  and the organization's access to it. An empty organization is incomplete.
- Record ownership, recovery details, publication date, and roles in the team's
  operator password/secrets manager, as used by
  [`docs/POSTMARK_PROVISIONING.md`](POSTMARK_PROVISIONING.md). Store recovery codes
  and any approved credentials only in operator storage. Enter one-time 2FA
  codes at the interactive prompt; never record them.
- Report the verified public result and the ownership-record location. Keep
  issue #99 open until its revised acceptance criteria are met. A missing public
  package, successful login, or new organization alone does not complete it.

# HelpDesk — Releasing

How HelpDesk images and deploy bundles are published. Nothing is deployed by CI: operators (and our
demo instance) run `deploy/upgrade.sh` themselves. What operators see is in `deploy/README.md`,
section 10; the design is in `docs/superpowers/specs/2026-10-22-deployment-design.md`.

## Every commit of main

The `publish` job of `.github/workflows/ci.yml` runs on a push to `main` once every required job
(`ci-result`) passed. It takes the image CI tested and:

- pushes `ghcr.io/surveyjs/supabase-helpdesk:sha-<full sha>` with a provenance attestation;
- moves `:edge` to it, but only while the commit is still the head of `main` (an older run that
  finishes late leaves `:edge` alone);
- keeps the deploy bundle as the artifact `helpdesk-deploy-sha-<sha>`;
- prints in its Summary the commands to upgrade demo to that commit:

  ```sh
  gh run download RUN_ID -R surveyjs/supabase-helpdesk -n helpdesk-deploy-sha-<sha>
  ./upgrade.sh --bundle helpdesk-deploy-sha-<sha>.tar.gz sha-<sha>
  ```

The images are linux/amd64 only (built on the CI runner; no multi-arch build).

## Cutting a release

1. Pick a commit of `main` whose CI run (push to `main`) is green, so its `:sha-<sha>` image exists.
2. Tag it and push the tag. **Push one release tag at a time** and wait for its run to finish:
   `:latest` and `:X.Y` are decided from the releases already published, and two runs at once could
   each miss the other.

   ```sh
   git tag vX.Y.Z <sha>            # or vX.Y.Z-rc.1 for a prerelease
   git push origin vX.Y.Z
   ```

   The tag is `vX.Y.Z` or `vX.Y.Z-pre` (`-rc.1`, `-beta`, …; no `+build`, Docker tags cannot hold `+`).
   Versions are `X.Y.Z` without leading zeros.

`.github/workflows/release.yml` (runs only in `surveyjs/supabase-helpdesk`, one run per tag) then:

1. checks that the tag is a version, that its commit is on `main`, that CI passed on a push to
   `main` for that commit, and that `:sha-<sha>` exists — otherwise it fails and publishes nothing;
2. builds the release image from `:sha-<sha>`: `FROM` it, `ENV HELPDESK_VERSION=X.Y.Z` and the
   version label — the layers are CI's (nothing is rebuilt), `release-image.sh` checks that before
   pushing;
3. pushes `:X.Y.Z`. A stable release also gets `:X.Y` if it is the highest of its line and `:latest`
   if it is the highest stable version — judged against the published releases (not drafts, not
   prereleases), not git tags. A prerelease gets `:X.Y.Z` only;
4. attests the image's provenance;
5. packs `helpdesk-deploy-vX.Y.Z.tar.gz` and its `.sha256` and attaches them to the GitHub release
   `vX.Y.Z` (notes generated; prerelease flag as per the tag; "Latest" follows `:latest`).
   `upgrade.sh X.Y.Z` downloads the bundle from there.

Check the run's Summary: image, digest, tags pushed, release link.

## Re-running

Re-run a failed or interrupted release run from the Actions tab (or `gh run rerun`). The image is
rebuilt from the same `:sha-<sha>` and pushed again, the release assets are replaced, and a draft
left by a failed upload is published. If a check failed (for example CI on that commit was not
finished), wait, then re-run. Do not move a published tag or reuse its version: cut the next patch.

## The N-1 upgrade test

The CI job `bundle-e2e-upgrade` installs the latest stable release (its bundle and its
`ghcr.io/…:X.Y.Z` image), signs in, upgrades it to the image of the pull request with that release's
own `upgrade.sh --migrate`, and rolls back. Until the first stable release exists it passes with a
"skipped" note in the Summary. Locally: `.github/scripts/bundle-e2e.sh` (see its header for
`FROM_RELEASE`, `FROM_RELEASE_DRY_RUN`).

## One-time setup

- After the first `publish` run, make the GHCR package `supabase-helpdesk` public (the
  `surveyjs` organization → Packages → `supabase-helpdesk` → Package settings → Change visibility).
  A new package is private, and operators pull without credentials.
- Check that the organization allows GitHub Actions to publish packages (Organization settings →
  Actions → General: workflow permissions; if the package restricts access, its "Manage Actions
  access" must list this repository with write access). `publish` and `release.yml` push with the
  workflow's `GITHUB_TOKEN`.

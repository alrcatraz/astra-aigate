;; .guix/channels.scm — the explicit channel pin for the CI toolchain.
;;
;; This file is the toolchain's single source of truth. `guix time-machine`
;; resolves it to a checkout under ~/.cache/guix; that checkout is what
;; actions/cache restores between runs (key = hash of THIS file), so the pin
;; being stable is what makes both reproducibility and the cache work.
;;
;; Why not the installer action's `channels` output (the pilot's original
;; shape): it follows whatever nightly tarball is "latest" today — the
;; environment would drift daily, the cache key would miss daily, and a green
;; run would prove nothing about tomorrow's. Pinning the identity in-repo is
;; the whole point of the Guix migration.
;;
;; Bump policy (decided 2026-10-01, see guix/ci/guix-to-work.md):
;;   - EVENT-DRIVEN ONLY — no schedule exists anywhere (owner constraint:
;;     bumps must not depend on an external agent or any OS outside the
;;     runner; the
;;     guix-drift bump-anchor workflow fires when .guix/** changes, on
;;     pull_request, or on dispatch): upstream renamed/removed something
;;     this manifest uses, a production node major gap, or a guix-daemon
;;     security advisory (fixes land only in rolling — Guix keeps no stable
;;     branch; that's what got guix removed from Debian).
;;   - FLOOR: bump within ~2 weeks of each Guix release (1.5.0 = 2026-01; the
;;     project adopted ~annual June releases via GCD) purely to prevent pin
;;     rot — a release is a reminder, not a gate.
;;   - Never auto-bump on a schedule.
;;   - NODE PARITY NOTE: this pin ships node-lts = v24.18.0, and package.json
;;     engines allows >=24 <27 — so the pinned node is inside the project's
;;     supported range today. Guix (this pin AND upstream master, checked
;;     2026-10-01 via the channel search endpoint) has NO node-25/node-26
;;     variable: matching production's node 26 will need a custom package
;;     definition (manifest-level or a private channel), tracked as an open
;;     item under the "production node major gap" trigger above.
;;
;; How to bump:
;;   1. get a candidate commit (a green nightly's identity, or any master SHA
;;      you choose): the drift smoke prints the nightly commit it used.
;;   2. replace (commit ...) below — it must be a 40-hex SHA on `branch`.
;;   3. keep (introduction ...) UNCHANGED: it is the channel's historical
;;      first-signed commit + signing key fingerprint, identical for every
;;      master commit (it authenticates the channel, not this revision).
;;   4. open a PR and let guix-smoke resolve the manifest under the new pin.
;;   - the first run after a bump re-fetches the git history incrementally
;;     (restore-keys reuse the old checkout — far cheaper than a fresh
;;     clone), then re-downloads store paths for the new build, so expect a
;;     partially cold run; subsequent runs re-hit the new key.
;;
;; FORM ATTENTION: the CI verifier greps `(commit "<40-hex>")` LINE-WISE, so
;; keep the opening token and the quoted SHA on ONE line. `guix describe
;; -f channels` pretty-prints with the string on its own line — the output
;; arrives flattened through the installer, but hand-written pins must not
;; copy that layout. The reader itself is whitespace-insensitive.
(list (channel
        (name 'guix)
        (url "https://git.guix.gnu.org/guix.git")
        (branch "master")
        (commit "5ceffb60e55b86920fd720817dd24b0e1f900ac1")
        (introduction (make-channel-introduction "9edb3f66fd807b096b48283debdcddccfea34bad" (openpgp-fingerprint "BBB0 2DDF 2CEA F6A8 0D1D  E643 A2A0 6DF2 A33A 54FA")))))


;; .guix/manifest.scm — declarative CI toolchain for astra-aigate.
;;
;; Purpose: give GitHub Actions jobs a reproducible userland (the core
;; utilities the CI gates invoke) independent of the ubuntu-latest image's
;; implicit package versions. The Guix revision that evaluates this file is
;; pinned by .guix/channels.scm — a commit committed to the repository,
;; bumped deliberately (see the policy in that file) — so this file only
;; declares WHICH tools a shell provides.
;;
;; The NODE RUNTIME IS DELIBERATELY NOT HERE (2026-10-02): CI runs the same
;; official nodejs.org tarball the production image unpacks, delivered by
;; .github/actions/node-dist (embedded by guix-toolchain before this
;; manifest resolves). A Guix-built node of the same version would link a
;; different glibc/OpenSSL and NOT be the image's bytes; the pinned channel
;; offers no 26.x at all (probe run 36945680396). With no node in the
;; profile, PATH inside $GUIX_SHELL falls through to the node dist — one
;; node (26.7.0) everywhere: npm ci, gates, tests, image builder.
;;
;; Usage inside a job (via the composite action, which exports GUIX_SHELL):
;;   $GUIX_SHELL <cmd>          # PATH resolves to the tools below
;; Expanding this list costs every consumer a few substituted downloads on a
;; cold run — add entries a gate actually invokes, not entries that look
;; tidy. `guix shell -m` takes the manifest; never add `-f` beside it (that
;; re-reads this file as PACKAGE definitions and fails with `unknown package`).
;;
;; Discipline (see guix/ci/guix-to-work.md): within a single `run:` step,
;; never mix distro-provided and Guix-provided binaries of the same tool —
;; the support tools come from this profile, the runtime from the node dist.
;;
;; Packages are referenced with EXPLICIT module qualifiers — (@ (module) var)
;; — rather than by bare variable after a blanket `use-modules`. Bare names
;; mean the reader must know which of the imported modules exports each
;; variable, and a name exported by two of them silently resolves to
;; whichever was imported last. The qualified form states the origin at the
;; point of use, so the manifest cannot be misread.
;;
;; Packaging notes for this list:
;;   - Variable name and package name can differ, so verify the VARIABLE in
;;     the module (see the module's gnu/packages/*.scm) rather than trusting
;;     that a working `guix shell <name>' implies a usable variable.
;;   - `jq` lives in (gnu packages web) — verified via the channel search
;;     endpoint (gnu/packages/jq.scm is 404; node-lts -> node.scm was the
;;     known-good control proving the query). `python` stays in (gnu packages
;;     python): the manifest load reported ONLY the jq module, so python
;;     resolved — fix one reported error at a time.

(use-modules (guix packages))

(packages->manifest
 (list
  ;; Language runtime (support side): python for gates that need it.
       (@ (gnu packages python) python)
  ;; Version control, search and data tools the gates shell out to.
       (@ (gnu packages version-control) git)
       (@ (gnu packages rust-apps) ripgrep)
       (@ (gnu packages web) jq)
  ;; CA bundle: a Guix-provided git links NO system cert store (git reports
  ;; `CAfile: none`), so ANY https operation inside the shell fails
  ;; certificate verification — `git fetch origin` in pr-test-policy died
  ;; with exit 128 on the PR's first real run. nss-certs installs the
  ;; Mozilla roots into the profile; git and curl pick them up.
       (@ (gnu packages certs) nss-certs)
  ;; Core userland the shell stages of CI jobs assume.
       (@ (gnu packages bash) bash)
       (@ (gnu packages base) coreutils)
       (@ (gnu packages base) findutils)
       (@ (gnu packages base) tar)
       (@ (gnu packages compression) gzip)))

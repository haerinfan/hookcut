# Working on Hookcut

The public source repository is https://github.com/haerinfan/hookcut.

For updates requested in this project, include repository synchronization in the completion workflow:

1. Preserve the local `.data` workspace and existing user footage, hooks, captions, and exports.
2. Run the tests appropriate to the change. Use `npm test` for application changes; the optional real speech test requires `HOOKCUT_TEST_MODEL`.
3. Stage only intended application, test, and documentation changes. Run `node scripts/check-public.mjs`. Scan for secrets with Gitleaks when available. Review public commit author information; use the GitHub no-reply address.
4. Commit and sync the tested changes to the existing repository within the user's authorized scope. A GitHub connector may be used when command-line push authentication is unavailable. Never overwrite unrelated remote changes or force-push without explicit authorization.
5. Verify that the remote branch contains the intended commit/tree. Report any failed upload or CI check clearly. Local edits alone are not a completed sync.

No background watcher uploads files. Never include `.data`, models, logs, environment files, credentials, private footage, or user backups. Keep publication checks effective; do not bypass them to make a push succeed.

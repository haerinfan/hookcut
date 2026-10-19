# Privacy and security

Hookcut is a local desktop workflow served through a browser. It binds to `127.0.0.1`; it is not designed as a multi-user or internet-facing server.

- No API keys, account passwords, wallet connections, analytics, or cloud inference are required.
- Videos, saved hooks, transcripts, speech model files, generated clips, and logs live in `.data/`, which Git ignores.
- The speech model is downloaded from the public whisper.cpp model repository on Hugging Face. Downloading contacts that service, but does not send your footage. Its SHA-256 and size are verified before use. Recognition runs locally afterward.
- State-changing requests require the local app header. Host and Origin checks reject cross-site access. A restrictive Content Security Policy limits the browser to local app resources.
- Subtitle text is escaped for display. Rendered ASS captions neutralize override characters, and media processing uses fixed arguments without a shell.
- Generated transcripts can be inaccurate, especially with background music, names, jargon, silence, and mixed languages. Review them before sharing.
- App data is stored as ordinary local files, not encrypted storage. Anyone who can read your computer's files can read the workspace.

## Before sharing a fork

Only publish app source, documentation, tests, and deliberately approved demo files. Do not publish `.data`, hook backups, private footage, environment files, credentials, or logs. The bundled practice footage is original synthetic demo content.

Run `node scripts/check-public.mjs` after staging changes. It inspects the Git index, rejects unexpected paths and common credentials or personal paths, and prints only filenames when it finds a problem. Enable it for commits with `git config core.hooksPath .githooks`. Use a dedicated secret scanner such as Gitleaks as an additional check; pattern scans cannot guarantee the absence of every kind of sensitive data.

GitHub stores the application source, not a backup of your local workspace. No GitHub credential is embedded in the app. Use a GitHub-provided no-reply email for public commits if you want to keep your contact address private.

If you discover a vulnerability, use the repository's private vulnerability reporting option when available. Do not post credentials, private footage, or unredacted logs in public issues.

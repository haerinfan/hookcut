# Hookcut verification

Tested locally on Windows with Node.js 24.20.0 and the installed FFmpeg / FFprobe build.

## Automated checks

The original suite passed 20 tests. Version 1.1 adds passage-selection, caption-injection, and real speech-recognition checks; see the latest verification below.

- Hook validation, tag deduplication, and rejection of executable source URL schemes.
- Create, update, favorite, use, and delete hooks.
- Hook backup round-trip, duplicate skipping, and all-or-nothing validation of imported hooks.
- Rejection of cross-origin requests and mutation requests without the local app header.
- No serving of the data directory or server source through the web server.
- Supported video import, metadata extraction, and rejection of invalid video bytes.
- HTTP byte-range playback, suffix requests, and invalid range handling.
- Trim boundary checks and export dimensions; audio tails do not extend the permitted video trim range.
- Actual vertical, square, and original MP4 exports, verified for duration, dimensions, codec, and audio behavior.
- Hook overlays containing punctuation and percentage signs.
- Cancelling queued and running exports, retrying, and blocking source removal during active jobs.
- Portrait display rotation metadata and silent video export.
- Persistence after server restart. Completed exports remain available after source removal.

- SRT parsing, BOM and line-ending handling, markup removal, and malformed-time rejection.
- Caption trimming, timing offsets, millisecond precision, and SRT round-trips.
- Export-time caption snapshots survive source-caption removal.

## Browser checks

- Visually inspected the library, clip studio, and export preview.
- Searched hooks; filtered favorites; attached a saved hook to the studio.
- Created and edited a hook through the form; verified clipboard copying and saving a variation without replacing the original.
- Pasted a batch of hooks and confirmed duplicate text was skipped.
- Restored exported clip settings with Edit a copy.
- Imported an actual video through the file picker and confirmed the source appeared.
- Loaded included practice footage, set trim points, attached an opening line, enabled the overlay, exported, and opened the resulting MP4 preview.
- Checked responsive layouts at 390px and 320px viewport widths; no horizontal document overflow at either width.
- Physically dragged the start handle and verified the matching time input and playhead; tested fine keyboard adjustment.
- Verified 1.5× preview playback, imported the practice SRT through the file picker, and confirmed visible caption preview and the separate SRT export link.
- No browser console warnings or errors observed during these workflows.

## Practical limits

- Automated checks use short synthetic videos. Long 2 GB files, variable-frame-rate footage, HDR sources, unusual codecs, and every source aspect ratio have not been exhaustively tested.
- Browser preview support depends on the source codec. Final exports are re-encoded as H.264 MP4.
- CPU encoding speed depends on the source and computer. One export runs at a time, using two encoder threads.
- Overlay preview and output use the same wording, wrapping, position, and approximate typography; browser and FFmpeg font rasterization can differ slightly.
- No automated subject tracking or social publishing integration is included. Local transcription uses a small model and needs human review.

## Portable bundle check

The ZIP was extracted into a separate folder whose path contains spaces. From that copy, the background launcher started successfully on a separate local port, loaded all 30 starter hooks, imported the bundled practice footage, and produced a real vertical MP4 with a hook overlay. The Windows stop shortcut then shut down that copy. The original workspace remains running on port 4317.

The ZIP excludes runtime data, imported user videos, logs, and font files. It includes source code, launchers, tests, documentation, and the original practice MP4/SRT.

## Version 1.1 verification

- Generated original synthetic speech lasting more than 30 seconds and transcribed it with the verified multilingual tiny model on CPU.
- Verified that timestamps continue across processing windows and that the final speech segment is retained. Input duration is bounded before decoding so the last buffered segment flushes correctly.
- Verified cancellation, rejection of concurrent generation, source/caption mutation protection during generation, and preservation of previous captions on cancellation.
- Checked passage ranges with offsets, reverse selection, overlapping cues, and video boundaries.
- Tested captions containing ASS-like syntax to prevent rendering commands from entering caption text.
- Exported an actual MP4 with both an opening hook and burned captions; extracted and visually inspected a frame. `docs/captioned-export.png` is that original-demo frame.
- Through the browser, selected a two-line passage, applied it to clip boundaries, enabled burned captions, and completed the export. Corrected a caption and searched the transcript.

The speech model stays local. The bundled speech demo is original synthetic narration, not private footage. The ordinary test run reports the optional speech test as skipped unless `HOOKCUT_TEST_MODEL` points to the verified model. CI uses the ordinary suite and does not download model files or upload user data.

Final local run: **23 tests passed**, including real speech recognition. The staged publication set passed Gitleaks 8.30.1 with no leaks found. The 320px browser layout had no horizontal overflow and no console warnings or errors were observed.

## Version 1.2 verification

- **27 tests passed**, including the real local speech test. The ordinary CI suite runs 26 tests and skips the optional model-dependent test.
- Verified preset allowlisting: saved presets exclude clip names, hook text, source IDs, notes, and source-specific timing.
- Verified moment validation, updates, deletion, and persistence across a server restart; source removal also removes its saved moments.
- Verified all-or-nothing batch validation, repeat-request deduplication, mismatched-request rejection, and actual MP4 output for both queued moments. Captions remain available after removing them from the source.
- Checked activity responses omit the hook library and full job history. Export cancellation now guards the preparation phase as well as the encoder process; retries and source deletion wait for processing to stop.
- In the browser, saved and applied a custom preset, saved two cuts with different framing, edited notes, searched moments, reloaded a cut's settings, and queued both cuts together. Both completed and appeared as ready exports.
- Verified a bookmark near the source end clamps to the video duration, and saved moments/presets survive a page reload.
- Verified export search and status filtering, the empty-results state, and the resulting MP4 preview.
- Inspected saved-moment and export layouts at 320px: no horizontal document overflow. No console warnings or errors observed during these checks.
- The staged source and Git history passed Gitleaks with no leaks found. The publication check approved 34 tracked files.
- Extracted the version 1.2 ZIP, checked archive integrity and private-file exclusions, and launched the fresh copy on a separate port. It loaded 30 starter hooks, three presets, and an empty moments list; the video engine was available. The test copy was then stopped.

These checks cover short demo footage and ordinary local use. They do not establish perfect behavior for every codec, unusually large workspace, or interrupted disk write.

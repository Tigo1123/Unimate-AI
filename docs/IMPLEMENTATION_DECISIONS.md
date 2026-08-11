# UniMate AI implementation decisions

This file records implementation choices made after approval of the architecture. The original SRS PDF is unchanged.

- Architecture: npm-workspaces modular monolith with separate web, API, and worker processes.
- Jobs: PostgreSQL-backed queue using `FOR UPDATE SKIP LOCKED`.
- Development storage: private local `uploads/` directory behind `StorageService`.
- Development AI: provider-neutral interface with a deterministic mock default.
- MVP input formats: validated PDF and TXT. DOCX and PPTX remain deferred until extractor quality is evaluated.
- Authentication: short-lived bearer access JWT and rotating refresh JWT in an HTTP-only cookie; server-side session hashes support revocation.
- Search: case-insensitive PostgreSQL search for courses, source names, and notes.
- Progress: derived only from activity inside UniMate and displayed with an explicit disclaimer.
- General AI mode and upcoming-exam widgets: excluded until their product boundaries and data model are specified.
- Initial localization: English interface with stored study and response-language preferences.

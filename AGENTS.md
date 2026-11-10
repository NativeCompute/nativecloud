# Working on NativeCloud

- No comments in source files. A short marker such as `-- save_project here` is the only exception. `tools/no-comments.sh` enforces it.
- Clients never write tables. Every change is a `security definer` function with `set search_path = public, pg_temp`, and it fails with an `nc:` message.
- Unknown and forbidden both answer `nc:not_found`.
- Every new function gets tests in `tests/sql/`. Run `bash tests/run.sh local` before pushing.
- Never edit a deployed migration; add a new one.
- Keep `docs/API.md` in step with the functions.

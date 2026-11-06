# Plans and limits

Limits live in the `plans` table, and the server enforces them in every function. Changing a number is one SQL update; no app release is needed.

| | Free beta (`free_beta`) | Pro (`pro`, for later) |
|---|---|---|
| Cloud scripts per account (personal and owned teams together) | 50 | 1,000 |
| Teams you own | 3 | 20 |
| People per team (members plus pending invites) | 10 | 50 |
| Automatic snapshots kept per script | 30 | 60 |
| Named snapshots per script (and safety copies kept) | 20 | 200 |
| Storage per account | 100 MB | 2 GB |
| Saves per minute | 30 | 120 |

**Rules of thumb:**
- A team's scripts count against its **owner's** plan, so the person who pays covers the team.
- Moving a script into someone else's team counts it against theirs.
- Safety copies (conflict, offline and restore snapshots) never block a save. The oldest are dropped instead.

**Why these numbers.** The free Supabase tier gives 500 MB of database. A typical feature script is 50–300 KB, plus snapshots. 50 scripts per account and 100 MB per account keep a few hundred active writers comfortably inside it.

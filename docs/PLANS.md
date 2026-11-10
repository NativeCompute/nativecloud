# Plans and limits

Limits live in the `plans` table, and the server enforces them in every function. Changing a number is one SQL update; no app release is needed.

**Organizations** are the tenant. Each one is on a flat tier, and its limits cover all of its spaces and people. **My cloud**, everyone's personal space, has its own free plan.

| | Free (`free`, personal) | Team (`team`) | Studio (`studio`) | Enterprise (`enterprise`) |
|---|---|---|---|---|
| People (members, guests and pending invites) | 1 | 10 | 50 | custom |
| Spaces | My cloud | 5 | unlimited | custom |
| Cloud scripts | 50 | 500 | 5,000 | custom |
| Storage | 100 MB | 2 GB | 20 GB | custom |
| Organizations you may start | 3 | — | — | — |
| Automatic snapshots kept per script | 30 | 30 | 60 | 90 |
| Named snapshots per script (and safety copies kept) | 20 | 50 | 200 | 1,000 |
| Saves per minute | 30 | 60 | 120 | 240 |
| Price (draft) | €0 | €19/month | €79/month | contact us |

**Rules of thumb:**
- A new organization starts on a **30-day Team trial**. Until billing exists, staff change tiers and end or extend trials from the staff console (`staff_set_plan`).
- When a trial ends, nothing locks yet. The panel shows it so we can follow up.
- A project's limits come from the space it's in: an organization's plan, or the owner's personal plan for My cloud.
- Safety copies (conflict, offline and restore snapshots) never block a save. The oldest are dropped instead.

**Why these numbers.** The free Supabase tier gives 500 MB of database, and a typical feature script is 50–300 KB plus snapshots. The free plan's limits keep a few hundred active writers comfortably inside that. Paid organizations are the reason to move to Supabase Pro.

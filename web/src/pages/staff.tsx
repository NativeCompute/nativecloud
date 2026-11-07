import { useEffect, useState } from "preact/hooks";
import { useLocation, useRoute } from "preact-iso";
import { Block, Button, Field, Meter, Page, PersonLine, Problem, Skeleton, State } from "../ui/kit";
import { confirm, fail, toast } from "../ui/overlay";
import { api } from "../lib/api";
import { useLoad } from "../lib/load";
import { useSession } from "../lib/session";
import { ago, bytes, day, planName } from "../lib/format";
import { sb } from "../lib/supabase";

const FREE_DB = 500 * 1048576;

function NotStaff() {
  return (
    <Page title="Staff only" sub="This part of NativeCloud is for the NativeCompute team.">
      <div class="actions">
        <a class="btn btn--primary btn--sm" href="/">
          Go home
        </a>
      </div>
    </Page>
  );
}

export function Staff() {
  const { me } = useSession();
  const stats = useLoad(() => (me?.staff ? api.staffStats() : Promise.resolve({})), [me?.staff]);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ users: any[]; orgs: any[] } | null>(null);
  useEffect(() => {
    if (!me?.staff) return;
    const t = setTimeout(() => {
      api
        .staffSearch(q.trim())
        .then(setFound)
        .catch(fail);
    }, 220);
    return () => clearTimeout(t);
  }, [q, me?.staff]);
  if (!me?.staff) return <NotStaff />;
  const s = stats.data as Record<string, any> | undefined;
  return (
    <Page eyebrow={`Staff · ${me.staff}`} title="Staff console" sub="Every change here is written to the audit log with your name.">
      {stats.error ? <Problem error={stats.error} retry={stats.reload} /> : null}
      {s && "users" in s ? (
        <>
          <section class="stats" aria-label="Platform">
            <div class="stat">
              <span class="hud">People</span>
              <span class="num">{s.users}</span>
              <span class="sec">
                {s.confirmed} confirmed · {s.signups_7d} new this week
              </span>
            </div>
            <div class="stat">
              <span class="hud">Organizations</span>
              <span class="num">{s.orgs}</span>
              <span class="sec">{s.orgs_active_7d} active this week</span>
            </div>
            <div class="stat">
              <span class="hud">Scripts</span>
              <span class="num">{s.projects}</span>
              <span class="sec">{bytes(s.project_bytes)}</span>
            </div>
            <div class="stat">
              <span class="hud">Database</span>
              <span class="num">{bytes(s.database_bytes)}</span>
              <Meter used={s.database_bytes} max={FREE_DB} shown={`${bytes(s.database_bytes)} of 500 MB`} />
            </div>
          </section>
          <p class="hud">
            Plans:{" "}
            {Object.entries(s.plans ?? {})
              .map(([k, v]) => `${planName(k)} ${v}`)
              .join(" · ") || "none"}{" "}
            · Suspended: {s.suspended_orgs} organizations, {s.suspended_users} people
          </p>
        </>
      ) : (
        <Skeleton rows={2} />
      )}
      <Field id="staff-q" label="Search people and organizations" hint="Email, name, slug or id.">
        <input class="input" id="staff-q" type="search" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      </Field>
      <div class="grid-2">
        <Block title="People">
          <ul class="list">
            {(found?.users ?? []).map((u) => (
              <li key={u.id}>
                <a class="row-link grow" href={`/staff/users/${u.id}`} style={{ textDecoration: "none" }}>
                  <PersonLine name={u.name || u.email} hue={0} line={u.email} />
                </a>
                {u.suspended ? <State tone="danger">Suspended</State> : <span class="hud">{day(u.created_at)}</span>}
              </li>
            ))}
            {found && !found.users.length ? <li class="sec">Nobody matches.</li> : null}
          </ul>
        </Block>
        <Block title="Organizations">
          <ul class="list">
            {(found?.orgs ?? []).map((o) => (
              <li key={o.id}>
                <a class="link grow" href={`/staff/orgs/${o.id}`}>
                  {o.name}
                </a>
                <span class="hud">
                  {planName(o.plan)} · {o.people} people
                </span>
                {o.suspended ? <State tone="danger">Suspended</State> : null}
              </li>
            ))}
            {found && !found.orgs.length ? <li class="sec">Nothing matches.</li> : null}
          </ul>
        </Block>
      </div>
    </Page>
  );
}

export function StaffUser() {
  const { me } = useSession();
  const { params } = useRoute();
  const { route } = useLocation();
  const user = useLoad(() => (me?.staff ? api.staffUser(params.id ?? "") : Promise.resolve(null)), [params.id, me?.staff]);
  const [reason, setReason] = useState("");
  if (!me?.staff) return <NotStaff />;
  if (user.error) return <Page title="Person"><Problem error={user.error} retry={user.reload} /></Page>;
  const u = user.data;
  if (!u) return <Page title="Person"><Skeleton rows={5} /></Page>;
  const admin = me.staff === "admin";
  return (
    <Page eyebrow="Staff / Person" title={u.name || u.email} sub={`${u.email} · joined ${day(u.created_at)}`}>
      <div class="grid-2">
        <Block title="Account">
          <dl class="kv">
            <div>
              <dt>Email</dt>
              <dd>
                {u.email} {u.confirmed ? <State tone="ok">Confirmed</State> : <State tone="warn">Not confirmed</State>}
              </dd>
            </div>
            <div>
              <dt>Last sign-in</dt>
              <dd>{ago(u.last_sign_in_at)}</dd>
            </div>
            <div>
              <dt>Plan</dt>
              <dd>{planName(u.plan)}</dd>
            </div>
            <div>
              <dt>Usage</dt>
              <dd>
                {u.usage?.projects ?? 0} scripts · {bytes(u.usage?.bytes ?? 0)} · {u.devices} computers
              </dd>
            </div>
            <div>
              <dt>Staff</dt>
              <dd>{u.staff ?? "No"}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{u.suspended ? <State tone="danger">Suspended: {u.suspended_reason || "no reason given"}</State> : <State tone="ok">Active</State>}</dd>
            </div>
          </dl>
        </Block>
        <Block title="Organizations">
          <ul class="list">
            {(u.orgs ?? []).map((o: any) => (
              <li key={o.id}>
                <a class="link" href={`/staff/orgs/${o.id}`}>
                  {o.name}
                </a>
                <span class="hud">{o.role}</span>
              </li>
            ))}
            {!u.orgs?.length ? <li class="sec">None.</li> : null}
          </ul>
        </Block>
      </div>
      <Block title="Actions">
        <div class="actions">
          {!u.confirmed ? (
            <Button
              kind="ghost"
              small
              onClick={async () => {
                const { error } = await sb.auth.resend({ type: "signup", email: u.email });
                if (error) fail(error);
                else toast("Confirmation code sent again.");
              }}
            >
              Resend confirmation
            </Button>
          ) : null}
        </div>
        <Field id="reason" label="Reason" hint="Written to the audit log and shown to staff.">
          <input class="input" id="reason" value={reason} onInput={(e) => setReason((e.target as HTMLInputElement).value)} />
        </Field>
        <div class="actions">
          <Button
            kind={u.suspended ? "primary" : "danger"}
            small
            onClick={async () => {
              const on = !u.suspended;
              if (on && !(await confirm({ title: `Suspend ${u.email}?`, body: "They're signed out of everything and can't sign in until you unsuspend them.", yes: "Suspend", danger: true })))
                return;
              try {
                await api.staffSuspendUser(u.id, on, reason);
                toast(on ? "Suspended." : "Unsuspended.");
                user.reload();
              } catch (e) {
                fail(e);
              }
            }}
          >
            {u.suspended ? "Unsuspend" : "Suspend"}
          </Button>
          {admin ? (
            <Button
              kind="danger"
              small
              onClick={async () => {
                if (!(await confirm({ title: `Delete ${u.email}?`, body: "For a deletion request. Their account and My cloud are deleted now; organizations they own pass on or are deleted.", yes: "Delete person", danger: true, typed: u.email })))
                  return;
                try {
                  await api.staffDeleteUser(u.id);
                  toast("Deleted.", "info");
                  route("/staff");
                } catch (e) {
                  fail(e);
                }
              }}
            >
              Delete for a request
            </Button>
          ) : null}
        </div>
      </Block>
    </Page>
  );
}

export function StaffOrg() {
  const { me } = useSession();
  const { params } = useRoute();
  const org = useLoad(() => (me?.staff ? api.staffOrg(params.id ?? "") : Promise.resolve(null)), [params.id, me?.staff]);
  const plans = useLoad(() => api.plans(), []);
  const [plan, setPlan] = useState("");
  const [trial, setTrial] = useState("");
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (org.data) setPlan(org.data.plan?.id ?? "");
  }, [org.data?.id]);
  if (!me?.staff) return <NotStaff />;
  if (org.error) return <Page title="Organization"><Problem error={org.error} retry={org.reload} /></Page>;
  const o = org.data;
  if (!o) return <Page title="Organization"><Skeleton rows={5} /></Page>;
  const u = o.usage ?? {};
  return (
    <Page eyebrow="Staff / Organization" title={o.name} sub={`/o/${o.slug} · since ${day(o.created_at)}`}>
      <div class="grid-2">
        <Block title={`${planName(o.plan?.id)} plan`}>
          <Meter label="People" used={u.people ?? 0} max={o.plan?.max_people ?? 0} shown={`${u.people} of ${o.plan?.max_people}`} />
          <Meter label="Spaces" used={u.spaces ?? 0} max={o.plan?.max_spaces ?? 0} shown={`${u.spaces} of ${o.plan?.max_spaces}`} />
          <Meter label="Scripts" used={u.projects ?? 0} max={o.plan?.max_projects ?? 0} shown={`${u.projects} of ${o.plan?.max_projects}`} />
          <Meter label="Storage" used={u.bytes ?? 0} max={o.plan?.max_bytes ?? 0} shown={`${bytes(u.bytes ?? 0)} of ${bytes(o.plan?.max_bytes ?? 0)}`} />
          <p class="sec">{o.trial_ends_at ? `Trial until ${day(o.trial_ends_at)}.` : "No trial."}</p>
        </Block>
        <Block title="Change plan">
          <form
            class="stack-4"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api.staffSetPlan(o.id, plan, trial.trim() ? Number(trial) : null);
                toast("Plan changed.");
                setTrial("");
                org.reload();
              } catch (err) {
                fail(err);
              }
            }}
          >
            <Field id="plan" label="Plan">
              <select class="select" id="plan" value={plan} onChange={(e) => setPlan((e.target as HTMLSelectElement).value)}>
                {(plans.data ?? [])
                  .filter((p) => p.scope !== "personal")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field id="trial" label="Trial days from today" optional hint="Leave empty to keep the trial as it is. 0 ends it.">
              <input class="input" id="trial" inputMode="numeric" value={trial} onInput={(e) => setTrial((e.target as HTMLInputElement).value.replace(/\D/g, ""))} />
            </Field>
            <div class="actions">
              <Button kind="primary" small type="submit">
                Save plan
              </Button>
            </div>
          </form>
        </Block>
      </div>
      <Block title="People">
        <ul class="list">
          {(o.members ?? []).map((m: any) => (
            <li key={m.id}>
              <a class="link grow" href={`/staff/users/${m.id}`}>
                {m.name || m.email}
              </a>
              <span class="hud">
                {m.role} · {m.email}
              </span>
            </li>
          ))}
        </ul>
      </Block>
      <Block title="Spaces">
        <ul class="list">
          {(o.spaces ?? []).map((s: any) => (
            <li key={s.id}>
              <span>{s.name}</span>
              <span class="hud">
                {s.projects} scripts{s.archived ? " · archived" : ""}
              </span>
            </li>
          ))}
        </ul>
      </Block>
      <Block title="Suspension">
        <p class="sec">{o.suspended ? `Suspended: ${o.suspended_reason || "no reason given"}.` : "Active. Suspending makes every space read only."}</p>
        <Field id="org-reason" label="Reason">
          <input class="input" id="org-reason" value={reason} onInput={(e) => setReason((e.target as HTMLInputElement).value)} />
        </Field>
        <div class="actions">
          <Button
            kind={o.suspended ? "primary" : "danger"}
            small
            onClick={async () => {
              const on = !o.suspended;
              if (on && !(await confirm({ title: `Suspend ${o.name}?`, body: "Its people can read and export but not change anything.", yes: "Suspend", danger: true }))) return;
              try {
                await api.staffSuspendOrg(o.id, on, reason);
                toast(on ? "Suspended." : "Unsuspended.");
                org.reload();
              } catch (e) {
                fail(e);
              }
            }}
          >
            {o.suspended ? "Unsuspend" : "Suspend"}
          </Button>
        </div>
      </Block>
    </Page>
  );
}

import { useEffect, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { Block, Button, Empty, Field, Meter, Page, Problem, Skeleton, State, Switch } from "../ui/kit";
import { confirm, fail, fresh, toast } from "../ui/overlay";
import { api, type Change, type Org, type Person, type Project } from "../lib/api";
import { useLoad } from "../lib/load";
import { manages, useOrg } from "../lib/org";
import { useSession } from "../lib/session";
import { ago, bytes, count, day, planName, price } from "../lib/format";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function NewOrg() {
  const { me, reload } = useSession();
  const { route } = useLocation();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  const owned = me.usage.owned_orgs ?? me.orgs.filter((o) => o.role === "owner").length;
  const full = owned >= me.plan.max_owned_orgs;
  return (
    <Page
      eyebrow="Organizations"
      title="New organization"
      sub={`An organization is where a team writes together. It starts on Team with a free trial. You own ${owned} of ${me.plan.max_owned_orgs}.`}
    >
      <form
        class="stack-6"
        style={{ maxWidth: "36rem" }}
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          if (!name.trim()) return setError("Give it a name.");
          setBusy(true);
          try {
            const made = await api.createOrg(name.trim(), slug.trim() || undefined);
            await reload();
            toast(`${name.trim()} is ready. Invite your team next.`);
            route(`/o/${made.slug}/members`);
          } catch (err) {
            fail(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field id="org-name" label="Name" error={error}>
          <input class="input" id="org-name" maxLength={80} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </Field>
        <Field id="org-slug" label="Web address" optional hint={`cloud.nativecompute.net/o/${slug || slugify(name) || "your-team"}`}>
          <input
            class="input"
            id="org-slug"
            maxLength={40}
            placeholder={slugify(name)}
            value={slug}
            onInput={(e) => setSlug((e.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
          />
        </Field>
        <div class="actions">
          <Button kind="primary" type="submit" busy={busy} disabled={full}>
            Create organization
          </Button>
          {full ? <span class="sec">You own as many organizations as your plan allows.</span> : null}
        </div>
      </form>
    </Page>
  );
}

function trialLine(o: Org): string {
  if (o.suspended) return "Suspended. Scripts can be read and exported, not changed.";
  if (o.trial_ends_at && Date.parse(o.trial_ends_at) > Date.now()) return `${planName(o.plan.id)} trial until ${day(o.trial_ends_at)}.`;
  return `${planName(o.plan.id)} plan.`;
}

function describe(c: Change, who: string, title: string): string {
  switch (c.kind) {
    case "project":
      return `${who} changed ${title}`;
    case "lease":
      return `${who} opened ${title} to write`;
    case "versions":
      return `${who} took a snapshot of ${title}`;
    case "members":
      return `${who} changed who's in the organization`;
    case "workspace":
      return `${who} changed the spaces`;
    case "org":
      return `${who} changed the organization`;
    default:
      return `${who} made a change`;
  }
}

export function OrgOverview() {
  const org = useOrg();
  const o = org.data;
  const spaces = useLoad(() => (o ? api.spaces(o.id) : Promise.resolve([])), [o?.id]);
  const ids = (spaces.data ?? []).map((s) => s.id);
  const projects = useLoad(() => api.projects(ids), [ids.join(",")]);
  const leases = useLoad(() => api.leases(), [ids.join(",")]);
  const changes = useLoad(() => (o ? api.changes(o.id, ids) : Promise.resolve([] as Change[])), [o?.id, ids.join(",")]);
  const people = useLoad(() => (o ? api.orgPeople(o.id) : Promise.resolve([] as Person[])), [o?.id]);
  useEffect(() => {
    const t = setInterval(() => {
      leases.reload();
      changes.reload();
    }, 30000);
    return () => clearInterval(t);
  }, [o?.id]);
  if (org.error) return <Page title="Organization"><Problem error={org.error} retry={org.reload} /></Page>;
  if (!o) return <Page title="Organization"><Skeleton rows={6} /></Page>;
  const byId = new Map<string, Project>((projects.data ?? []).map((p) => [p.id, p]));
  const names = new Map((people.data ?? []).map((p) => [p.user_id, p.display_name || "Someone"]));
  const live = (leases.data ?? []).filter((l) => byId.has(l.project_id));
  const u = o.usage;
  const steps = [
    { done: u.people > 1 || u.pending > 0, label: "Invite the people you write with", href: `/o/${o.slug}/members` },
    { done: u.spaces > 1, label: "Add a space for each show or season", href: `/o/${o.slug}/spaces` },
    { done: u.projects > 0, label: "Save a script to this organization from Blackline", href: `/o/${o.slug}/projects` },
  ];
  return (
    <Page eyebrow={`${planName(o.plan.id)} · ${o.role}`} title={o.name} sub={trialLine(o)}>
      {o.suspended ? (
        <div class="banner" role="status">
          <span>This organization is suspended. Contact hello@nativecompute.com.</span>
        </div>
      ) : null}
      <section class="stats" aria-label="Usage">
        <div class="stat">
          <span class="hud">People</span>
          <span class="num">{u.people}</span>
          <Meter used={u.people + u.pending} max={o.plan.max_people} shown={`${u.people} of ${o.plan.max_people}`} />
        </div>
        <div class="stat">
          <span class="hud">Spaces</span>
          <span class="num">{u.spaces}</span>
          <Meter used={u.spaces} max={o.plan.max_spaces} shown={`${u.spaces} of ${o.plan.max_spaces}`} />
        </div>
        <div class="stat">
          <span class="hud">Scripts</span>
          <span class="num">{u.projects.toLocaleString("en-GB")}</span>
          <Meter used={u.projects} max={o.plan.max_projects} shown={`${u.projects} of ${o.plan.max_projects}`} />
        </div>
        <div class="stat">
          <span class="hud">Storage</span>
          <span class="num">{bytes(u.bytes)}</span>
          <Meter used={u.bytes} max={o.plan.max_bytes} shown={`${bytes(u.bytes)} of ${bytes(o.plan.max_bytes)}`} />
        </div>
      </section>
      {manages(o) && steps.some((s) => !s.done) ? (
        <Block title="Getting started">
          <ul class="list">
            {steps.map((s) => (
              <li key={s.label}>
                <State tone={s.done ? "ok" : undefined}>{s.done ? "Done" : "To do"}</State>
                <a class="link grow" href={s.href}>
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
      <div class="grid-2">
        <Block title="Writing now" aside={<span class="live hud">{live.length ? count(live.length, "script") : "Quiet"}</span>}>
          {live.length ? (
            <ul class="list">
              {live.map((l) => (
                <li key={l.project_id}>
                  <span>
                    <strong>{names.get(l.user_id) ?? "Someone"}</strong> is writing{" "}
                    <a class="link" href={`/o/${o.slug}/projects?open=${l.project_id}`}>
                      {byId.get(l.project_id)?.title || "a script"}
                    </a>
                  </span>
                  {l.device_name ? <span class="hud">{l.device_name}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p class="sec">Nobody has a script open to write right now. When someone does, it shows here.</p>
          )}
        </Block>
        <Block title="Recent changes">
          {changes.data?.length ? (
            <ul class="list">
              {changes.data.slice(0, 10).map((c) => (
                <li key={c.seq}>
                  <span class="grow">{describe(c, (c.by && names.get(c.by)) || "Someone", (c.project_id && byId.get(c.project_id)?.title) || "a script")}</span>
                  <span class="hud">{ago(c.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p class="sec">Nothing has changed yet.</p>
          )}
        </Block>
      </div>
      {manages(o) && u.pending ? (
        <div class="banner">
          <span>{count(u.pending, "invite")} waiting to be accepted.</span>
          <a class="btn btn--quiet btn--sm" href={`/o/${o.slug}/members`}>
            See invites
          </a>
        </div>
      ) : null}
    </Page>
  );
}

export function OrgPlan() {
  const org = useOrg();
  const plans = useLoad(() => api.plans(), []);
  const o = org.data;
  if (org.error) return <Page title="Plan and usage"><Problem error={org.error} retry={org.reload} /></Page>;
  if (!o) return <Page title="Plan and usage"><Skeleton rows={6} /></Page>;
  const u = o.usage;
  const tiers = (plans.data ?? []).filter((p) => p.scope !== "personal");
  const mail = (tier: string) =>
    `mailto:hello@nativecompute.com?subject=${encodeURIComponent(`${o.name}: ${tier} plan`)}&body=${encodeURIComponent(`Organization: ${o.name} (/o/${o.slug})\n`)}`;
  return (
    <Page eyebrow={o.name} title="Plan and usage" sub={trialLine(o)}>
      <Block title={`${planName(o.plan.id)} · ${price(o.plan.price_cents)}`}>
        <div class="grid-2">
          <Meter label="People" used={u.people + u.pending} max={o.plan.max_people} shown={`${u.people} + ${u.pending} invited of ${o.plan.max_people}`} />
          <Meter label="Spaces" used={u.spaces} max={o.plan.max_spaces} shown={`${u.spaces} of ${o.plan.max_spaces}`} />
          <Meter label="Cloud scripts" used={u.projects} max={o.plan.max_projects} shown={`${u.projects} of ${o.plan.max_projects}`} />
          <Meter label="Storage" used={u.bytes} max={o.plan.max_bytes} shown={`${bytes(u.bytes)} of ${bytes(o.plan.max_bytes)}`} />
        </div>
        <dl class="kv">
          <div>
            <dt>Snapshots</dt>
            <dd>
              {o.plan.max_kept_snapshots} named per script, {o.plan.max_auto_snapshots} automatic
            </dd>
          </div>
          <div>
            <dt>Billing</dt>
            <dd>Paid plans are arranged with us by email for now. Card payments come later.</dd>
          </div>
        </dl>
      </Block>
      <Block title="Plans">
        {plans.loading && !plans.data ? <Skeleton /> : null}
        <div class="cards">
          {tiers.map((p) => {
            const current = p.id === o.plan.id;
            return (
              <div key={p.id} class={`card${current ? " card--chosen" : ""}`}>
                <div class="card-head">
                  <h3>{p.name}</h3>
                  {current ? <span class="card-flag">Current</span> : null}
                </div>
                <p class="price">
                  <span class="num">{p.id === "enterprise" ? "Talk to us" : price(p.price_cents)}</span>
                </p>
                <ul>
                  <li>{p.id === "enterprise" ? "As many people as you need" : `Up to ${p.max_people} people`}</li>
                  <li>{p.max_spaces >= 1000 ? "Unlimited spaces" : count(p.max_spaces, "space")}</li>
                  <li>{p.max_projects.toLocaleString("en-GB")} cloud scripts</li>
                  <li>{bytes(p.max_bytes)} of storage</li>
                </ul>
                {current ? null : manages(o) ? (
                  <a class="btn btn--ghost btn--sm" href={mail(p.name)}>
                    {p.rank > o.plan.rank ? `Move to ${p.name}` : `Talk to us about ${p.name}`}
                  </a>
                ) : null}
              </div>
            );
          })}
        </div>
      </Block>
    </Page>
  );
}

export function OrgSettings() {
  const org = useOrg();
  const { me, reload } = useSession();
  const { route } = useLocation();
  const o = org.data;
  const people = useLoad(() => (o && o.role === "owner" ? api.orgPeople(o.id) : Promise.resolve([] as Person[])), [o?.id, o?.role]);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [heir, setHeir] = useState("");
  useEffect(() => {
    if (o) {
      setName(o.name);
      setSlug(o.slug);
    }
  }, [o?.id, o?.name, o?.slug]);
  if (org.error) return <Page title="Settings"><Problem error={org.error} retry={org.reload} /></Page>;
  if (!o || !me) return <Page title="Settings"><Skeleton rows={6} /></Page>;
  const can = manages(o);
  const save = async (run: () => Promise<unknown>, done: string) => {
    try {
      await run();
      toast(done);
      await reload();
      org.reload();
    } catch (e) {
      fail(e);
    }
  };
  const others = (people.data ?? []).filter((p) => p.user_id !== me.id && p.role !== "guest");
  return (
    <Page eyebrow={o.name} title="Settings">
      {can ? (
        <div class="grid-2">
          <Block title="Name and address">
            <form
              class="stack-6"
              onSubmit={async (e) => {
                e.preventDefault();
                if (name.trim() !== o.name) await save(() => api.renameOrg(o.id, name.trim()), "Renamed.");
                if (slug.trim() !== o.slug) {
                  await save(() => api.setOrgSlug(o.id, slug.trim()), "Web address changed. The old one keeps working.");
                  route(`/o/${slug.trim()}/settings`, true);
                }
              }}
            >
              <Field id="org-name" label="Name">
                <input class="input" id="org-name" maxLength={80} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
              </Field>
              <Field id="org-slug" label="Web address" hint={`cloud.nativecompute.net/o/${slug}`}>
                <input
                  class="input"
                  id="org-slug"
                  maxLength={40}
                  value={slug}
                  onInput={(e) => setSlug((e.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                />
              </Field>
              <div class="actions">
                <Button kind="primary" small type="submit" disabled={!name.trim() || !slug.trim() || (name.trim() === o.name && slug.trim() === o.slug)}>
                  Save
                </Button>
              </div>
            </form>
          </Block>
          <Block title="Members">
            <Switch
              id="members-create"
              label="Members can create spaces"
              hint="Owners and admins always can. Guests never can."
              checked={o.settings.members_create_spaces !== false}
              onChange={(v) => save(() => api.updateOrgSettings(o.id, { members_create_spaces: v }), v ? "Members can create spaces." : "Only owners and admins create spaces now.")}
            />
          </Block>
        </div>
      ) : (
        <p class="sec">Only owners and admins change these settings.</p>
      )}
      <section class="danger-zone block" aria-label="Danger zone">
        <div class="block-head">
          <h2>Danger zone</h2>
        </div>
        {o.role === "owner" ? (
          <div class="row-action">
            <div class="stack-2">
              <strong>Hand over ownership</strong>
              <p class="sec">They become the owner and you become an admin.</p>
            </div>
            {others.length ? (
              <div class="row">
                <label class="sr-only" for="heir">
                  New owner
                </label>
                <select class="select" id="heir" value={heir} onChange={(e) => setHeir((e.target as HTMLSelectElement).value)}>
                  <option value="">Choose someone…</option>
                  {others.map((p) => (
                    <option key={p.user_id} value={p.user_id}>
                      {p.display_name || p.email}
                    </option>
                  ))}
                </select>
                <Button
                  kind="danger"
                  small
                  disabled={!heir}
                  onClick={async () => {
                    const p = others.find((x) => x.user_id === heir);
                    if (!p || !(await confirm({ title: `Make ${p.display_name || p.email} the owner?`, body: "Only the owner can delete the organization or hand it over again.", yes: "Hand over", danger: true })))
                      return;
                    try {
                      const done = await fresh(() => api.transferOrg(o.id, heir));
                      if (done === undefined) return;
                      toast("Handed over. You're an admin now.");
                      await reload();
                      org.reload();
                    } catch (e) {
                      fail(e);
                    }
                  }}
                >
                  Hand over
                </Button>
              </div>
            ) : (
              <span class="sec">Invite an admin or member first.</span>
            )}
          </div>
        ) : (
          <div class="row-action">
            <div class="stack-2">
              <strong>Leave {o.name}</strong>
              <p class="sec">Its spaces leave your library. Someone can invite you back.</p>
            </div>
            <Button
              kind="danger"
              small
              onClick={async () => {
                if (!(await confirm({ title: `Leave ${o.name}?`, body: "You lose access to its scripts straight away.", yes: "Leave", danger: true }))) return;
                try {
                  await api.leaveOrg(o.id);
                  await reload();
                  toast(`You left ${o.name}.`, "info");
                  route("/me");
                } catch (e) {
                  fail(e);
                }
              }}
            >
              Leave
            </Button>
          </div>
        )}
        {o.role === "owner" ? (
          <div class="row-action">
            <div class="stack-2">
              <strong>Delete {o.name}</strong>
              <p class="sec">Its spaces, scripts and snapshots are deleted for everyone. Copies on people's computers stay.</p>
            </div>
            <Button
              kind="danger"
              small
              onClick={async () => {
                if (!(await confirm({ title: `Delete ${o.name}?`, body: "This can't be undone.", yes: "Delete organization", danger: true, typed: o.slug }))) return;
                try {
                  const done = await fresh(() => api.deleteOrg(o.id));
                  if (done === undefined) return;
                  await reload();
                  toast(`${o.name} is deleted.`, "info");
                  route("/me");
                } catch (e) {
                  fail(e);
                }
              }}
            >
              Delete
            </Button>
          </div>
        ) : null}
      </section>
      {can ? null : (
        <Empty title="Need a change?">Ask an owner or admin. They're listed on the Members page.</Empty>
      )}
    </Page>
  );
}

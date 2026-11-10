import { useState } from "preact/hooks";
import { Block, Button, Empty, Field, Page, PersonLine, Problem, Skeleton, State } from "../ui/kit";
import { Tray, confirm, fail, toast } from "../ui/overlay";
import { api, type Invite, type Org, type OrgRole, type Person, type SpaceRole, type Workspace } from "../lib/api";
import { useLoad } from "../lib/load";
import { manages, useOrg } from "../lib/org";
import { useSession } from "../lib/session";
import { ago, day, emailOk, emails, planName } from "../lib/format";
import { toError } from "../lib/errors";

const roleText: Record<OrgRole, string> = { owner: "Owner", admin: "Admin", member: "Member", guest: "Guest" };
const roleHint: Record<string, string> = {
  admin: "Manages people, spaces and settings.",
  member: "Writes in every space.",
  guest: "Sees only the spaces you choose.",
};

function InviteTray({ org, spaces, open, onClose, onDone }: { org: Org; spaces: Workspace[]; open: boolean; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const [chosen, setChosen] = useState<string[]>([]);
  const [spaceRole, setSpaceRole] = useState<SpaceRole>("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = emails(text);
  const bad = list.filter((e) => !emailOk(e));
  const roles: OrgRole[] = org.role === "owner" ? ["member", "admin", "guest"] : ["member", "guest"];
  const send = async (e: Event) => {
    e.preventDefault();
    setError(null);
    if (!list.length) return setError("Add at least one email address.");
    if (bad.length) return setError(`Check ${bad.join(", ")}.`);
    if (role === "guest" && !chosen.length) return setError("Pick the spaces a guest can see.");
    setBusy(true);
    let sent = 0;
    let saved = 0;
    const failed: string[] = [];
    for (const email of list) {
      try {
        const id = await api.inviteMember(org.id, email, role, role === "guest" ? chosen : [], spaceRole);
        const r = await api.sendInvite(id).catch(() => ({ sent: false }));
        if (r.sent) sent++;
        else saved++;
      } catch (err) {
        failed.push(`${email}: ${toError(err).message}`);
      }
    }
    setBusy(false);
    if (sent) toast(`${sent} ${sent === 1 ? "invite" : "invites"} sent.`);
    if (saved) toast(`${saved} ${saved === 1 ? "invite" : "invites"} saved. Tell them to sign in to NativeCloud with that address.`, "info");
    if (failed.length) {
      setError(failed.join(" "));
      setText(failed.map((f) => f.split(":")[0]).join("\n"));
    } else {
      setText("");
      setChosen([]);
      onClose();
    }
    onDone();
  };
  return (
    <Tray
      open={open}
      title="Invite people"
      onClose={onClose}
      foot={
        <Button kind="primary" block busy={busy} onClick={send}>
          {list.length > 1 ? `Send ${list.length} invites` : "Send invite"}
        </Button>
      }
    >
      <form class="stack-6" onSubmit={send} noValidate>
        <Field id="invite-emails" label="Emails" hint="One or many, separated by commas or new lines." error={error}>
          <textarea class="textarea" id="invite-emails" rows={4} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
        </Field>
        <fieldset class="checks">
          <legend class="hud">Role</legend>
          {roles.map((r) => (
            <label key={r} class="check">
              <input type="radio" name="invite-role" checked={role === r} onChange={() => setRole(r)} />
              <span class="t">
                <span>{roleText[r]}</span>
                <span>{roleHint[r]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {role === "guest" ? (
          <>
            <fieldset class="checks">
              <legend class="hud">Spaces they can see</legend>
              {spaces
                .filter((s) => !s.archived_at)
                .map((s) => (
                  <label key={s.id} class="check">
                    <input
                      type="checkbox"
                      checked={chosen.includes(s.id)}
                      onChange={(e) => setChosen((e.target as HTMLInputElement).checked ? [...chosen, s.id] : chosen.filter((x) => x !== s.id))}
                    />
                    <span class="t">
                      <span>{s.name}</span>
                    </span>
                  </label>
                ))}
            </fieldset>
            <Field id="space-role" label="In those spaces they can">
              <select class="select" id="space-role" value={spaceRole} onChange={(e) => setSpaceRole((e.target as HTMLSelectElement).value as SpaceRole)}>
                <option value="editor">Read and write</option>
                <option value="viewer">Only read</option>
              </select>
            </Field>
          </>
        ) : null}
        <p class="sec">Invites are open for 14 days. {org.usage.people + org.usage.pending} of {org.plan.max_people} places on {planName(org.plan.id)} are taken.</p>
      </form>
    </Tray>
  );
}

function RoleCell({ org, p, me, onChange }: { org: Org; p: Person; me: string; onChange: () => void }) {
  const editable = manages(org) && p.user_id !== me && p.role !== "owner" && !(org.role === "admin" && p.role === "admin");
  if (!editable) return <State tone={p.role === "guest" ? "warn" : undefined}>{roleText[p.role]}</State>;
  const options: OrgRole[] = org.role === "owner" ? ["admin", "member", "guest"] : ["member", "guest"];
  return (
    <select
      class="select"
      aria-label={`Role for ${p.display_name || p.email}`}
      value={p.role}
      style={{ minHeight: "44px", fontSize: "var(--t-sec)" }}
      onChange={async (e) => {
        const role = (e.target as HTMLSelectElement).value as OrgRole;
        try {
          await api.setOrgRole(org.id, p.user_id, role);
          toast(`${p.display_name || p.email} is ${role === "admin" ? "an admin" : `a ${role}`} now.`);
        } catch (err) {
          fail(err);
        }
        onChange();
      }}
    >
      {options.map((r) => (
        <option key={r} value={r}>
          {roleText[r]}
        </option>
      ))}
    </select>
  );
}

function Pending({ org, spaces, invites, reload }: { org: Org; spaces: Workspace[]; invites: Invite[]; reload: () => void }) {
  if (!invites.length) return null;
  return (
    <Block title="Waiting to join" aside={<State tone="signal">{invites.length} open</State>}>
      <div class="table-wrap">
        <table class="table table--stack">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Open until</th>
              <th class="act">
                <span class="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {invites.map((i) => (
              <tr key={i.id}>
                <td data-label="">{i.email}</td>
                <td data-label="Role">
                  {roleText[i.role]}
                  {i.role === "guest" && i.spaces.length ? ` · ${i.spaces.map((s) => spaces.find((w) => w.id === s)?.name ?? "").filter(Boolean).join(", ")}` : ""}
                </td>
                <td data-label="Open until">{day(i.expires_at)}</td>
                <td class="act" data-label="">
                  <span class="actions">
                    <Button
                      kind="quiet"
                      small
                      onClick={async () => {
                        try {
                          const r = await api.sendInvite(i.id);
                          toast(r.sent ? `Sent again to ${i.email}.` : "Email isn't set up on this server. The invite is still waiting.", r.sent ? "ok" : "info");
                        } catch (e) {
                          fail(e);
                        }
                      }}
                    >
                      Resend
                    </Button>
                    <Button
                      kind="quiet"
                      small
                      onClick={async () => {
                        if (!(await confirm({ title: `Take back the invite to ${i.email}?`, body: "The link in their email stops working.", yes: "Take back", danger: true }))) return;
                        try {
                          await api.revokeInvite(i.id);
                          reload();
                        } catch (e) {
                          fail(e);
                        }
                      }}
                    >
                      Take back
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p class="sec">{org.usage.pending} waiting.</p>
    </Block>
  );
}

export function Members() {
  const org = useOrg();
  const { me } = useSession();
  const o = org.data;
  const people = useLoad(() => (o ? api.orgPeople(o.id) : Promise.resolve([] as Person[])), [o?.id]);
  const invites = useLoad(() => (o && manages(o) ? api.invites(o.id) : Promise.resolve([] as Invite[])), [o?.id, o?.role]);
  const spaces = useLoad(() => (o ? api.spaces(o.id) : Promise.resolve([] as Workspace[])), [o?.id]);
  const [inviting, setInviting] = useState(false);
  if (org.error) return <Page title="Members"><Problem error={org.error} retry={org.reload} /></Page>;
  if (!o || !me) return <Page title="Members"><Skeleton rows={6} /></Page>;
  const can = manages(o);
  const refresh = () => {
    people.reload();
    invites.reload();
    org.reload();
  };
  const spaceNames = (p: Person) =>
    (p.spaces ?? [])
      .map((s) => spaces.data?.find((w) => w.id === s.id)?.name)
      .filter(Boolean)
      .join(", ");
  return (
    <Page
      eyebrow={o.name}
      title="Members"
      sub={`${o.usage.people} of ${o.plan.max_people} people on ${planName(o.plan.id)}.`}
      action={
        can ? (
          <Button kind="primary" small onClick={() => setInviting(true)} disabled={o.suspended}>
            Invite people
          </Button>
        ) : null
      }
    >
      {people.error ? <Problem error={people.error} retry={people.reload} /> : null}
      {!people.data ? <Skeleton rows={4} /> : null}
      {people.data ? (
        <Block title="People">
          <div class="table-wrap">
            <table class="table table--stack">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  {can ? <th>Spaces</th> : null}
                  {can ? <th>Last active</th> : null}
                  <th class="act">
                    <span class="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {people.data.map((p) => (
                  <tr key={p.user_id}>
                    <td data-label="">
                      <PersonLine name={`${p.display_name || p.email || "Someone"}${p.user_id === me.id ? " (you)" : ""}`} hue={p.avatar_hue} line={p.email} />
                    </td>
                    <td data-label="Role">
                      <RoleCell org={o} p={p} me={me.id} onChange={refresh} />
                    </td>
                    {can ? <td data-label="Spaces">{p.role === "guest" ? spaceNames(p) || "None" : "All"}</td> : null}
                    {can ? <td data-label="Last active">{ago(p.last_active)}</td> : null}
                    <td class="act" data-label="">
                      {can && p.user_id !== me.id && p.role !== "owner" && !(o.role === "admin" && p.role === "admin") ? (
                        <Button
                          kind="quiet"
                          small
                          onClick={async () => {
                            const who = p.display_name || p.email || "them";
                            if (!(await confirm({ title: `Remove ${who} from ${o.name}?`, body: "They lose access to its scripts straight away. Anything they're writing is freed.", yes: "Remove", danger: true })))
                              return;
                            try {
                              await api.removeMember(o.id, p.user_id);
                              toast(`${who} was removed.`, "info");
                              refresh();
                            } catch (e) {
                              fail(e);
                            }
                          }}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {o.role === "guest" ? <p class="sec">As a guest you see yourself and the people who run {o.name}.</p> : null}
        </Block>
      ) : null}
      {can ? <Pending org={o} spaces={spaces.data ?? []} invites={invites.data ?? []} reload={refresh} /> : null}
      {can && people.data?.length === 1 && !invites.data?.length ? (
        <Empty title="Just you so far" action={<Button kind="primary" small onClick={() => setInviting(true)}>Invite people</Button>}>
          Invite the people you write with. They get an email with a link to join.
        </Empty>
      ) : null}
      {can ? <InviteTray org={o} spaces={spaces.data ?? []} open={inviting} onClose={() => setInviting(false)} onDone={refresh} /> : null}
    </Page>
  );
}

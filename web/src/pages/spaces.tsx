import { useState } from "preact/hooks";
import { Block, Button, Empty, Field, Page, PersonLine, Problem, Skeleton, State } from "../ui/kit";
import { Tray, confirm, fail, fresh, toast } from "../ui/overlay";
import { api, type Membership, type Person, type Project, type SpaceRole, type Workspace } from "../lib/api";
import { useLoad } from "../lib/load";
import { manages, useOrg } from "../lib/org";
import { useSession } from "../lib/session";
import { count, day } from "../lib/format";

function PeopleTray({ space, people, members, onClose, onChange }: { space: Workspace | null; people: Person[]; members: Membership[]; onClose: () => void; onChange: () => void }) {
  return (
    <Tray open={!!space} title={space ? `People in ${space.name}` : "People"} onClose={onClose}>
      <p class="sec">Owners, admins and members are in every space as editors by default. Guests see only the spaces you add them to.</p>
      <ul class="list">
        {people.map((p) => {
          const m = members.find((x) => x.workspace_id === space?.id && x.user_id === p.user_id);
          const value = m ? m.role : "";
          return (
            <li key={p.user_id}>
              <PersonLine name={p.display_name || p.email || "Someone"} hue={p.avatar_hue} line={p.role} />
              <select
                class="select"
                style={{ width: "auto", minHeight: "44px", fontSize: "var(--t-sec)" }}
                aria-label={`Access for ${p.display_name || p.email}`}
                value={value}
                onChange={async (e) => {
                  if (!space) return;
                  const v = (e.target as HTMLSelectElement).value;
                  try {
                    await api.setSpaceMember(space.id, p.user_id, v ? (v as SpaceRole) : null);
                    onChange();
                  } catch (err) {
                    fail(err);
                  }
                }}
              >
                <option value="editor">Reads and writes</option>
                <option value="viewer">Only reads</option>
                <option value="">Not in it</option>
              </select>
            </li>
          );
        })}
      </ul>
    </Tray>
  );
}

export function Spaces() {
  const org = useOrg();
  const { me } = useSession();
  const o = org.data;
  const spaces = useLoad(() => (o ? api.spaces(o.id) : Promise.resolve([] as Workspace[])), [o?.id]);
  const ids = (spaces.data ?? []).map((s) => s.id);
  const members = useLoad(() => api.memberships(ids), [ids.join(",")]);
  const projects = useLoad(() => api.projects(ids), [ids.join(",")]);
  const people = useLoad(() => (o && manages(o) ? api.orgPeople(o.id) : Promise.resolve([] as Person[])), [o?.id, o?.role]);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [managing, setManaging] = useState<Workspace | null>(null);
  if (org.error) return <Page title="Spaces"><Problem error={org.error} retry={org.reload} /></Page>;
  if (!o || !me || !spaces.data) return <Page title="Spaces"><Skeleton rows={5} /></Page>;
  const can = manages(o);
  const canCreate = can || (o.role === "member" && o.settings.members_create_spaces !== false);
  const full = o.usage.spaces >= o.plan.max_spaces;
  const reload = () => {
    spaces.reload();
    org.reload();
  };
  const scripts = (ws: string) => (projects.data ?? []).filter((p: Project) => p.workspace_id === ws && !p.deleted_at).length;
  const inSpace = (ws: string) => (members.data ?? []).filter((m) => m.workspace_id === ws);
  const act = async (run: () => Promise<unknown>, done: string) => {
    try {
      await run();
      toast(done);
      reload();
    } catch (e) {
      fail(e);
    }
  };
  return (
    <Page eyebrow={o.name} title="Spaces" sub={`A space keeps one show's scripts together. ${o.usage.spaces} of ${o.plan.max_spaces >= 1000 ? "unlimited" : o.plan.max_spaces} in use.`}>
      {canCreate ? (
        <form
          class="row"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            try {
              await api.createSpace(o.id, name.trim());
              toast(`${name.trim()} is ready.`);
              setName("");
              reload();
            } catch (err) {
              fail(err);
            }
          }}
        >
          <div class="grow">
            <Field id="space-name" label="New space">
              <input class="input" id="space-name" maxLength={80} placeholder="Season 2" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
            </Field>
          </div>
          <Button kind="primary" type="submit" disabled={!name.trim() || full || o.suspended} style={{ alignSelf: "flex-end" }}>
            Create space
          </Button>
        </form>
      ) : null}
      {full && canCreate ? <p class="sec">This plan's spaces are all in use. Archive one or move to a bigger plan.</p> : null}
      {spaces.data.length === 0 ? <Empty title="No spaces yet">Create one to start writing together.</Empty> : null}
      <Block title={count(spaces.data.length, "space")}>
        <ul class="list">
          {spaces.data.map((s) => (
            <li key={s.id}>
              <div class="stack-2 grow">
                {renaming?.id === s.id ? (
                  <form
                    class="row"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      await act(() => api.renameSpace(s.id, renaming.name.trim()), "Renamed.");
                      setRenaming(null);
                    }}
                  >
                    <label class="sr-only" for={`rename-${s.id}`}>
                      Name
                    </label>
                    <input
                      class="input grow"
                      id={`rename-${s.id}`}
                      style={{ minHeight: "44px", fontSize: "var(--t-body)" }}
                      maxLength={80}
                      value={renaming.name}
                      onInput={(e) => setRenaming({ id: s.id, name: (e.target as HTMLInputElement).value })}
                    />
                    <Button kind="primary" small type="submit" disabled={!renaming.name.trim()}>
                      Save
                    </Button>
                    <Button kind="quiet" small onClick={() => setRenaming(null)}>
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <strong>{s.name}</strong>
                )}
                <span class="row">
                  <span class="sec">
                    {count(scripts(s.id), "script")} · {count(inSpace(s.id).length, "person", "people")} · since {day(s.created_at)}
                  </span>
                  {s.archived_at ? <State tone="warn">Archived, read only</State> : null}
                </span>
              </div>
              {can && renaming?.id !== s.id ? (
                <span class="actions">
                  <Button kind="quiet" small onClick={() => setManaging(s)}>
                    People
                  </Button>
                  <Button kind="quiet" small onClick={() => setRenaming({ id: s.id, name: s.name })}>
                    Rename
                  </Button>
                  <Button
                    kind="quiet"
                    small
                    onClick={() => act(() => api.archiveSpace(s.id, !s.archived_at), s.archived_at ? "Back in use." : "Archived. Its scripts are read only now.")}
                  >
                    {s.archived_at ? "Unarchive" : "Archive"}
                  </Button>
                  <Button
                    kind="quiet"
                    small
                    onClick={async () => {
                      if (!(await confirm({ title: `Delete ${s.name}?`, body: `Its ${count(scripts(s.id), "script")} and their snapshots are deleted for everyone.`, yes: "Delete space", danger: true, typed: s.name })))
                        return;
                      try {
                        const done = await fresh(() => api.deleteSpace(s.id));
                        if (done === undefined) return;
                        toast(`${s.name} is deleted.`, "info");
                        reload();
                      } catch (e) {
                        fail(e);
                      }
                    }}
                  >
                    Delete
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </Block>
      {can ? (
        <PeopleTray
          space={managing}
          people={people.data ?? []}
          members={members.data ?? []}
          onClose={() => setManaging(null)}
          onChange={() => {
            members.reload();
            people.reload();
          }}
        />
      ) : null}
    </Page>
  );
}

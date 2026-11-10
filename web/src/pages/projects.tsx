import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { Block, Button, Empty, Page, Problem, Skeleton, State } from "../ui/kit";
import { Tray, confirm, fail, toast } from "../ui/overlay";
import { api, type EditSession, type Lease, type Profile, type Project, type Snapshot, type Workspace } from "../lib/api";
import { useLoad } from "../lib/load";
import { useOrg } from "../lib/org";
import { useSession } from "../lib/session";
import { ago, bytes, day, fileName } from "../lib/format";
import { query } from "../lib/nav";
import { download } from "./account";

const PAGE = 25;
const kinds: Record<string, string> = {
  manual: "Snapshot",
  revision: "Revision",
  offline: "Kept from offline",
  conflict: "Kept from a conflict",
  restore: "Before restoring",
  auto: "Automatic",
};

interface Ctx {
  spaces: Workspace[];
  people: Map<string, Profile>;
  leases: Lease[];
  writable: (ws: string) => boolean;
  reload: () => void;
}

function personName(ctx: Ctx, id: string | null | undefined): string {
  if (!id) return "Someone";
  return ctx.people.get(id)?.display_name || "Someone";
}

function ProjectTray({ id, ctx, onClose }: { id: string | null; ctx: Ctx; onClose: () => void }) {
  const project = useLoad(() => (id ? api.project(id) : Promise.resolve(null)), [id]);
  const snaps = useLoad(() => (id ? api.snapshots(id) : Promise.resolve([] as Snapshot[])), [id]);
  const sessions = useLoad(() => (id ? api.editSessions(id) : Promise.resolve([] as EditSession[])), [id]);
  const [tab, setTab] = useState<"preview" | "history">("preview");
  const [viewing, setViewing] = useState<{ label: string; body: string } | null>(null);
  const [to, setTo] = useState("");
  useEffect(() => {
    setTab("preview");
    setViewing(null);
    setTo("");
  }, [id]);
  const p = project.data;
  const space = p ? ctx.spaces.find((s) => s.id === p.workspace_id) : undefined;
  const canWrite = p ? ctx.writable(p.workspace_id) : false;
  const targets = ctx.spaces.filter((s) => p && s.id !== p.workspace_id && !s.archived_at && ctx.writable(s.id));
  const lease = p ? ctx.leases.find((l) => l.project_id === p.id) : undefined;
  const run = async (what: () => Promise<unknown>, done: string) => {
    try {
      await what();
      toast(done);
      project.reload();
      snaps.reload();
      ctx.reload();
    } catch (e) {
      fail(e);
    }
  };
  return (
    <Tray
      open={!!id}
      title={p?.title || "Script"}
      onClose={onClose}
      foot={
        p ? (
          <div class="actions">
            <Button kind="ghost" small onClick={() => download(new Blob([p.body ?? ""], { type: "text/markdown" }), `${fileName(p.title)}.${p.app_id === "blackline" ? "md" : "txt"}`)}>
              Download
            </Button>
            {canWrite && !p.deleted_at ? (
              <Button
                kind="quiet"
                small
                onClick={async () => {
                  if (!(await confirm({ title: `Delete ${p.title}?`, body: "It moves to Recently deleted for 30 days. Anyone in the space can bring it back.", yes: "Delete", danger: true })))
                    return;
                  await run(() => api.deleteProject(p.id), "Moved to Recently deleted.");
                }}
              >
                Delete
              </Button>
            ) : null}
            {canWrite && p.deleted_at ? (
              <>
                <Button kind="primary" small onClick={() => run(() => api.restoreProject(p.id), "Restored.")}>
                  Restore
                </Button>
                <Button
                  kind="quiet"
                  small
                  onClick={async () => {
                    if (!(await confirm({ title: "Delete it for good?", body: "The script and its snapshots are gone for everyone. This can't be undone.", yes: "Delete forever", danger: true })))
                      return;
                    try {
                      await api.purgeProject(p.id);
                      toast("Deleted for good.", "info");
                      ctx.reload();
                      onClose();
                    } catch (e) {
                      fail(e);
                    }
                  }}
                >
                  Delete forever
                </Button>
              </>
            ) : null}
          </div>
        ) : null
      }
    >
      {project.error ? <Problem error={project.error} retry={project.reload} /> : null}
      {!p ? (
        <Skeleton />
      ) : (
        <>
          <dl class="kv">
            <div>
              <dt>Space</dt>
              <dd>{space ? (space.kind === "personal" ? "My cloud" : space.name) : "Unknown"}</dd>
            </div>
            <div>
              <dt>Changed</dt>
              <dd>
                {ago(p.updated_at)} by {personName(ctx, p.updated_by)}
              </dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>
                {p.version} · {bytes(p.size)}
              </dd>
            </div>
            {lease ? (
              <div>
                <dt>Now</dt>
                <dd>
                  <State tone="signal">
                    {personName(ctx, lease.user_id)} is writing{lease.device_name ? ` on ${lease.device_name}` : ""}
                  </State>
                </dd>
              </div>
            ) : null}
            {p.deleted_at ? (
              <div>
                <dt>Deleted</dt>
                <dd>{day(p.deleted_at)}</dd>
              </div>
            ) : null}
          </dl>
          {canWrite && !p.deleted_at && targets.length ? (
            <div class="row">
              <label class="sr-only" for="move-to">
                Move to
              </label>
              <select class="select grow" id="move-to" value={to} onChange={(e) => setTo((e.target as HTMLSelectElement).value)}>
                <option value="">Move to another space…</option>
                {targets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.kind === "personal" ? "My cloud" : s.name}
                  </option>
                ))}
              </select>
              <Button kind="ghost" small disabled={!to} onClick={() => run(() => api.moveProject(p.id, to), "Moved.")}>
                Move
              </Button>
            </div>
          ) : null}
          <div class="tabs" role="tablist">
            <button class="tab" role="tab" type="button" aria-selected={tab === "preview"} onClick={() => setTab("preview")}>
              Preview
            </button>
            <button class="tab" role="tab" type="button" aria-selected={tab === "history"} onClick={() => setTab("history")}>
              History
            </button>
          </div>
          {tab === "preview" ? (
            <>
              {viewing ? (
                <div class="row row--between">
                  <span class="hud">Showing {viewing.label}</span>
                  <Button kind="quiet" small onClick={() => setViewing(null)}>
                    Show the current text
                  </Button>
                </div>
              ) : null}
              <pre class="script-preview" tabIndex={0} aria-label="Script text">
                {(viewing ? viewing.body : p.body) || "This script is empty."}
              </pre>
            </>
          ) : (
            <>
              <p class="hud">Snapshots</p>
              {snaps.data?.length ? (
                <ul class="history">
                  {snaps.data.map((s) => (
                    <li key={s.id}>
                      <span class="stack-2">
                        <strong>{s.label || kinds[s.kind] || "Snapshot"}</strong>
                        <span class="sec">
                          {kinds[s.kind] ?? s.kind} · {ago(s.created_at)} · {personName(ctx, s.created_by)}
                        </span>
                      </span>
                      <span class="actions">
                        <Button
                          kind="quiet"
                          small
                          onClick={async () => {
                            try {
                              setViewing({ label: s.label || ago(s.created_at), body: await api.snapshotBody(s.id) });
                              setTab("preview");
                            } catch (e) {
                              fail(e);
                            }
                          }}
                        >
                          View
                        </Button>
                        {canWrite && !p.deleted_at ? (
                          <Button
                            kind="ghost"
                            small
                            onClick={async () => {
                              if (!(await confirm({ title: "Restore this snapshot?", body: "The current text is kept as a snapshot first, so nothing is lost.", yes: "Restore" }))) return;
                              try {
                                const r = await api.restoreSnapshot(s.id, p.version);
                                if (r.status === "saved") toast("Restored. Everyone sees it next time their app syncs.");
                                else if (r.status === "locked") toast("Someone is writing in it right now. Try when they're done.", "danger");
                                else toast("It changed while you were looking. Open it again and retry.", "danger");
                                project.reload();
                                snaps.reload();
                              } catch (e) {
                                fail(e);
                              }
                            }}
                          >
                            Restore
                          </Button>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p class="sec">No snapshots yet. Apps take them before big changes, and you can take named ones in the app.</p>
              )}
              <p class="hud">Writing sessions</p>
              {sessions.data?.length ? (
                <ul class="history">
                  {sessions.data.map((s) => (
                    <li key={s.id}>
                      <span>{personName(ctx, s.user_id)}</span>
                      <span class="sec">
                        {ago(s.ended_at)} · {s.saves} {s.saves === 1 ? "save" : "saves"} · {s.words_delta >= 0 ? "+" : ""}
                        {s.words_delta} words
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p class="sec">No writing sessions recorded yet.</p>
              )}
            </>
          )}
        </>
      )}
    </Tray>
  );
}

export function ProjectsBrowser({
  spaces,
  writable,
  title,
  eyebrow,
  sub,
  top,
}: {
  spaces: Workspace[];
  writable: (ws: string) => boolean;
  title: string;
  eyebrow: string;
  sub?: string;
  top?: ComponentChildren;
}) {
  const { route, path } = useLocation();
  const ids = spaces.map((s) => s.id);
  const list = useLoad(() => api.projects(ids), [ids.join(",")]);
  const leases = useLoad(() => api.leases(), [ids.join(",")]);
  const stars = useLoad(() => api.stars(), []);
  const people = useLoad(async () => {
    const who = new Set<string>();
    for (const p of list.data ?? []) {
      if (p.updated_by) who.add(p.updated_by);
      if (p.created_by) who.add(p.created_by);
    }
    for (const l of leases.data ?? []) who.add(l.user_id);
    return new Map((await api.profiles([...who])).map((p) => [p.id, p]));
  }, [list.data, leases.data]);
  const [text, setText] = useState("");
  const [space, setSpace] = useState("");
  const [app, setApp] = useState("");
  const [show, setShow] = useState<"all" | "starred" | "deleted">("all");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(() => query().get("open"));
  useEffect(() => setPage(0), [text, space, app, show]);
  const apps = useMemo(() => [...new Set((list.data ?? []).map((p) => p.app_id))].sort(), [list.data]);
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (list.data ?? []).filter(
    (p) =>
      (show === "deleted" ? !!p.deleted_at : !p.deleted_at) &&
      (show !== "starred" || stars.data?.has(p.id)) &&
      (!space || p.workspace_id === space) &&
      (!app || p.app_id === app) &&
      words.every((w) => p.title.toLowerCase().includes(w)),
  );
  const ctx: Ctx = {
    spaces,
    people: people.data ?? new Map(),
    leases: leases.data ?? [],
    writable,
    reload: () => {
      list.reload();
      leases.reload();
    },
  };
  const rows = shown.slice(page * PAGE, page * PAGE + PAGE);
  const spaceName = (id: string) => {
    const s = spaces.find((x) => x.id === id);
    return s ? (s.kind === "personal" ? "My cloud" : s.name) : "";
  };
  const openRow = (p: Project | null) => {
    setOpen(p?.id ?? null);
    route(p ? `${path}?open=${p.id}` : path, true);
  };
  return (
    <Page eyebrow={eyebrow} title={title} sub={sub}>
      {top}
      <div class="filters">
        <div class="field">
          <label for="find">Find</label>
          <input class="input" id="find" type="search" placeholder="Title" value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} />
        </div>
        {spaces.length > 1 ? (
          <div class="field">
            <label for="space">Space</label>
            <select class="select" id="space" value={space} onChange={(e) => setSpace((e.target as HTMLSelectElement).value)}>
              <option value="">All spaces</option>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {spaceName(s.id)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {apps.length > 1 ? (
          <div class="field">
            <label for="app">App</label>
            <select class="select" id="app" value={app} onChange={(e) => setApp((e.target as HTMLSelectElement).value)}>
              <option value="">All apps</option>
              {apps.map((a) => (
                <option key={a} value={a}>
                  {a.charAt(0).toUpperCase() + a.slice(1)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div class="field">
          <label for="show">Show</label>
          <select class="select" id="show" value={show} onChange={(e) => setShow((e.target as HTMLSelectElement).value as typeof show)}>
            <option value="all">Everything</option>
            <option value="starred">Starred</option>
            <option value="deleted">Recently deleted</option>
          </select>
        </div>
      </div>
      {list.error ? <Problem error={list.error} retry={list.reload} /> : null}
      {list.loading && !list.data ? <Skeleton rows={5} /> : null}
      {list.data && shown.length === 0 ? (
        <Empty title={show === "deleted" ? "Nothing deleted" : list.data.length ? "Nothing matches" : "No scripts yet"}>
          {list.data.length
            ? "Try another word or filter."
            : "Scripts saved to the cloud from Blackline and the other NativeCompute apps show up here."}
        </Empty>
      ) : null}
      {rows.length ? (
        <Block title={`${shown.length} ${shown.length === 1 ? "script" : "scripts"}`}>
          <div class="table-wrap">
            <table class="table table--stack">
              <thead>
                <tr>
                  <th>Title</th>
                  {spaces.length > 1 ? <th>Space</th> : null}
                  <th>Changed</th>
                  <th class="num-col">Size</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const l = ctx.leases.find((x) => x.project_id === p.id);
                  return (
                    <tr key={p.id} aria-selected={open === p.id}>
                      <td data-label="">
                        <div class="stack-2">
                          <a
                            class="row-link"
                            href={`${path}?open=${p.id}`}
                            onClick={(e) => {
                              e.preventDefault();
                              openRow(p);
                            }}
                          >
                            {p.title || "Untitled"}
                          </a>
                          {l ? <State tone="signal">{personName(ctx, l.user_id)} writing</State> : null}
                        </div>
                      </td>
                      {spaces.length > 1 ? <td data-label="Space">{spaceName(p.workspace_id)}</td> : null}
                      <td data-label="Changed">
                        {ago(p.updated_at)} · {personName(ctx, p.updated_by)}
                      </td>
                      <td class="num-col" data-label="Size">
                        {bytes(p.size)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {shown.length > PAGE ? (
            <div class="pager">
              <span class="hud">
                {page * PAGE + 1}–{Math.min(shown.length, page * PAGE + PAGE)} of {shown.length}
              </span>
              <span class="actions">
                <Button kind="ghost" small disabled={page === 0} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <Button kind="ghost" small disabled={(page + 1) * PAGE >= shown.length} onClick={() => setPage(page + 1)}>
                  Next
                </Button>
              </span>
            </div>
          ) : null}
        </Block>
      ) : null}
      <ProjectTray id={open} ctx={ctx} onClose={() => openRow(null)} />
    </Page>
  );
}

export function OrgProjects() {
  const org = useOrg();
  const { me } = useSession();
  const spaces = useLoad(() => (org.data ? api.spaces(org.data.id) : Promise.resolve([] as Workspace[])), [org.data?.id]);
  const mine = useLoad(
    () => (spaces.data && me ? api.memberships(spaces.data.map((s) => s.id)) : Promise.resolve([])),
    [spaces.data, me?.id],
  );
  if (org.error) return <Page title="Projects"><Problem error={org.error} retry={org.reload} /></Page>;
  if (!org.data || !spaces.data || !mine.data) return <Page title="Projects"><Skeleton rows={5} /></Page>;
  const visible = spaces.data.filter((s) => mine.data!.some((m) => m.workspace_id === s.id && m.user_id === me?.id));
  const writable = (ws: string) => !org.data!.suspended && mine.data!.some((m) => m.workspace_id === ws && m.user_id === me?.id && m.role !== "viewer");
  return <ProjectsBrowser spaces={visible} writable={writable} title="Projects" eyebrow={org.data.name} sub="Every script in the spaces you're in. Writing happens in the apps; here you look, restore and tidy." />;
}

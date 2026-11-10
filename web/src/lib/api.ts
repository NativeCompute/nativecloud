import type { Session } from "@supabase/supabase-js";
import { ApiError, toError } from "./errors";
import { sb } from "./supabase";

export type OrgRole = "owner" | "admin" | "member" | "guest";
export type SpaceRole = "owner" | "editor" | "viewer";

export interface Plan {
  id: string;
  name: string;
  scope: string;
  max_people: number;
  max_spaces: number;
  max_projects: number;
  max_bytes: number;
  max_owned_orgs: number;
  max_auto_snapshots: number;
  max_kept_snapshots: number;
  trial_days: number;
  price_cents: number;
  paid: boolean;
  rank: number;
}

export interface Usage {
  projects: number;
  bytes: number;
  owned_orgs?: number;
  people?: number;
  pending?: number;
  spaces?: number;
}

export interface OrgRef {
  id: string;
  name: string;
  slug: string;
  role: OrgRole;
  plan: string;
  trial_ends_at: string | null;
  suspended: boolean;
}

export interface Me {
  id: string;
  email: string;
  display_name: string;
  avatar_hue: number;
  plan: Plan;
  usage: Usage;
  personal_workspace: string;
  staff: string | null;
  orgs: OrgRef[];
}

export interface Org {
  id: string;
  name: string;
  slug: string;
  role: OrgRole;
  settings: { members_create_spaces?: boolean };
  plan: Plan;
  usage: Required<Usage>;
  trial_ends_at: string | null;
  suspended: boolean;
  created_at: string;
}

export interface Person {
  user_id: string;
  display_name: string;
  avatar_hue: number;
  role: OrgRole;
  joined_at: string;
  email?: string | null;
  last_active?: string | null;
  spaces?: { id: string; role: SpaceRole }[];
}

export interface Workspace {
  id: string;
  name: string;
  kind: "personal" | "space";
  org_id: string | null;
  owner_id: string | null;
  archived_at: string | null;
  created_at: string;
}

export interface Membership {
  workspace_id: string;
  user_id: string;
  role: SpaceRole;
}

export interface Invite {
  id: string;
  email: string;
  role: OrgRole;
  spaces: string[];
  space_role: SpaceRole;
  expires_at: string;
  created_at: string;
}

export interface InviteDetails {
  id: string;
  email: string;
  role: OrgRole;
  expires_at: string;
  state: "pending" | "accepted" | "declined" | "revoked" | "expired";
  org_id: string;
  org: string;
  org_slug: string;
  invited_by: string | null;
}

export interface MyInvite {
  id: string;
  role: OrgRole;
  expires_at: string;
  org_id: string;
  org: string;
  org_slug: string;
  invited_by: string | null;
}

export interface Project {
  id: string;
  workspace_id: string;
  app_id: string;
  title: string;
  version: number;
  size: number;
  updated_at: string;
  updated_by: string | null;
  created_by: string | null;
  deleted_at: string | null;
  body?: string;
}

export interface Snapshot {
  id: string;
  project_id: string;
  version: number;
  size: number;
  label: string;
  kind: string;
  created_by: string | null;
  created_at: string;
}

export interface EditSession {
  id: number;
  project_id: string;
  user_id: string | null;
  started_at: string;
  ended_at: string;
  words_delta: number;
  saves: number;
}

export interface Device {
  id: string;
  name: string;
  platform: string;
  last_seen: string;
}

export interface Lease {
  project_id: string;
  user_id: string;
  device_name: string;
  expires_at: string;
}

export interface Change {
  seq: number;
  workspace_id: string | null;
  org_id: string | null;
  project_id: string | null;
  kind: string;
  by: string | null;
  at: string;
}

export interface Profile {
  id: string;
  display_name: string;
  avatar_hue: number;
}

export interface App {
  id: string;
  name: string;
}

export type Saved = { status: "saved"; version: number } | { status: "conflict" } | { status: "locked"; lease?: unknown };

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    const { data, error } = await sb.rpc(name, args);
    if (error) throw toError(error);
    return data as T;
  } catch (e) {
    throw toError(e);
  }
}

async function rows<T>(table: string, build: (q: any) => any): Promise<T[]> {
  try {
    const { data, error } = await build(sb.from(table));
    if (error) throw toError(error);
    return (data ?? []) as T[];
  } catch (e) {
    throw toError(e);
  }
}

async function fn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  let res: { data: unknown; error: unknown };
  try {
    res = await sb.functions.invoke(name, { body });
  } catch (e) {
    throw toError(e);
  }
  if (res.error) {
    const ctx = (res.error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const b = await ctx.json().catch(() => ({}));
      throw new ApiError(String(b.error ?? "nc:server"));
    }
    throw toError(res.error);
  }
  const d = res.data as Record<string, unknown> | null;
  if (d && typeof d.error === "string") throw new ApiError(d.error);
  return res.data as T;
}

const uuidList = (ids: string[]) => `(${ids.filter((i) => /^[0-9a-f-]{36}$/i.test(i)).join(",")})`;

export const api = {
  me: () => rpc<Me>("me"),
  updateProfile: (display_name: string, avatar_hue: number) => rpc<void>("update_profile", { display_name, avatar_hue }),
  devices: () => rows<Device>("devices", (q) => q.select("id,name,platform,last_seen").order("last_seen", { ascending: false })),
  forgetDevice: (device_id: string) => rpc<void>("forget_device", { device_id }),
  apps: () => rows<App>("apps", (q) => q.select("id,name").order("name")),
  plans: () => rows<Plan>("plans", (q) => q.select("*").order("rank")),
  profiles: (ids: string[]) =>
    ids.length ? rows<Profile>("profiles", (q) => q.select("id,display_name,avatar_hue").in("id", ids)) : Promise.resolve([] as Profile[]),

  orgBySlug: (slug: string) => rpc<Org>("org_by_slug", { slug }),
  orgPeople: (org: string) => rpc<Person[]>("org_people", { org }),
  createOrg: (name: string, slug?: string) => rpc<{ id: string; slug: string; space: string }>("create_org", { name, slug: slug || null }),
  renameOrg: (org: string, name: string) => rpc<void>("rename_org", { org, name }),
  setOrgSlug: (org: string, slug: string) => rpc<void>("set_org_slug", { org, slug }),
  updateOrgSettings: (org: string, settings: Record<string, unknown>) => rpc<void>("update_org_settings", { org, settings }),
  deleteOrg: (org: string) => rpc<void>("delete_org", { org }),
  transferOrg: (org: string, member: string) => rpc<void>("transfer_org", { org, member }),
  leaveOrg: (org: string) => rpc<void>("leave_org", { org }),
  setOrgRole: (org: string, member: string, role: OrgRole) => rpc<void>("set_org_role", { org, member, role }),
  removeMember: (org: string, member: string) => rpc<void>("remove_member", { org, member }),

  spaces: (org: string) =>
    rows<Workspace>("workspaces", (q) => q.select("id,name,kind,org_id,owner_id,archived_at,created_at").eq("org_id", org).order("created_at")),
  allWorkspaces: () => rows<Workspace>("workspaces", (q) => q.select("id,name,kind,org_id,owner_id,archived_at,created_at").order("created_at")),
  personal: (me: string) =>
    rows<Workspace>("workspaces", (q) => q.select("id,name,kind,org_id,owner_id,archived_at,created_at").eq("owner_id", me).eq("kind", "personal")),
  memberships: (spaces: string[]) =>
    spaces.length
      ? rows<Membership>("memberships", (q) => q.select("workspace_id,user_id,role").filter("workspace_id", "in", uuidList(spaces)))
      : Promise.resolve([] as Membership[]),
  createSpace: (org: string, name: string) => rpc<string>("create_space", { org, name }),
  renameSpace: (ws: string, name: string) => rpc<void>("rename_space", { ws, name }),
  archiveSpace: (ws: string, archived: boolean) => rpc<void>("archive_space", { ws, archived }),
  deleteSpace: (ws: string) => rpc<void>("delete_space", { ws }),
  setSpaceMember: (ws: string, member: string, role: SpaceRole | null) => rpc<void>("set_space_member", { ws, member, role }),

  invites: (org: string) =>
    rows<Invite>("invites", (q) =>
      q
        .select("id,email,role,spaces,space_role,expires_at,created_at")
        .eq("org_id", org)
        .is("accepted_at", null)
        .is("declined_at", null)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false }),
    ),
  inviteMember: (org: string, email: string, role: OrgRole, spaces: string[] = [], space_role: SpaceRole = "editor") =>
    rpc<string>("invite_member", { org, email, role, spaces, space_role }),
  sendInvite: (invite_id: string) => fn<{ sent: boolean }>("send-invite", { invite_id }),
  revokeInvite: (invite: string) => rpc<void>("revoke_invite", { invite }),
  inviteDetails: (invite: string) => rpc<InviteDetails>("invite_details", { invite }),
  myInvites: () => rpc<MyInvite[]>("my_invites"),
  acceptInvite: (invite: string) => rpc<string>("accept_invite", { invite }),
  declineInvite: (invite: string) => rpc<void>("decline_invite", { invite }),

  projects: (spaces: string[]) =>
    spaces.length
      ? rows<Project>("projects", (q) =>
          q
            .select("id,workspace_id,app_id,title,version,size,updated_at,updated_by,created_by,deleted_at")
            .filter("workspace_id", "in", uuidList(spaces))
            .order("updated_at", { ascending: false }),
        )
      : Promise.resolve([] as Project[]),
  findProjects: (text: string) =>
    rows<Project>("projects", (q) =>
      q.select("id,workspace_id,app_id,title,updated_at,deleted_at").ilike("title", `%${text.replace(/[%_,()]/g, " ")}%`).is("deleted_at", null).limit(8),
    ),
  project: async (id: string) => {
    const list = await rows<Project>("projects", (q) =>
      q.select("id,workspace_id,app_id,title,version,size,updated_at,updated_by,created_by,deleted_at,body").eq("id", id),
    );
    if (!list[0]) throw new ApiError("nc:not_found");
    return list[0];
  },
  exportAll: () => rows<Project>("projects", (q) => q.select("id,workspace_id,app_id,title,updated_at,deleted_at,body").order("updated_at", { ascending: false })),
  snapshots: (id: string) =>
    rows<Snapshot>("project_versions", (q) =>
      q.select("id,project_id,version,size,label,kind,created_by,created_at").eq("project_id", id).order("created_at", { ascending: false }),
    ),
  snapshotBody: async (id: string) => {
    const list = await rows<{ body: string }>("project_versions", (q) => q.select("body").eq("id", id));
    return list[0]?.body ?? "";
  },
  editSessions: (id: string) =>
    rows<EditSession>("edit_sessions", (q) => q.select("*").eq("project_id", id).order("ended_at", { ascending: false }).limit(50)),
  stars: async () => new Set((await rows<{ project_id: string }>("stars", (q) => q.select("project_id"))).map((r) => r.project_id)),
  leases: () => rows<Lease>("leases", (q) => q.select("project_id,user_id,device_name,expires_at").gt("expires_at", new Date().toISOString())),
  changes: (org: string, spaces: string[]) =>
    rows<Change>("changes", (q) =>
      q
        .select("seq,workspace_id,org_id,project_id,kind,by,at")
        .or(spaces.length ? `org_id.eq.${org},workspace_id.in.${uuidList(spaces)}` : `org_id.eq.${org}`)
        .order("seq", { ascending: false })
        .limit(25),
    ),
  moveProject: (p: string, to_workspace: string) => rpc<void>("move_project", { p, to_workspace }),
  deleteProject: (p: string) => rpc<void>("delete_project", { p }),
  restoreProject: (p: string) => rpc<void>("restore_project", { p }),
  purgeProject: (p: string) => rpc<void>("purge_project", { p }),
  restoreSnapshot: (snapshot: string, base_version: number) =>
    rpc<Saved>("restore_snapshot", { snapshot, base_version, device_id: null }),

  createAppGrant: (app: string, device: string, challenge: string) => rpc<string>("create_app_grant", { app, device, challenge }),
  takeHandoff: async (code: string) => {
    const s = await fn<Session & { app?: string }>("app-token", { code });
    if (!s?.access_token || !s.refresh_token) throw new ApiError("nc:invalid:code");
    return s;
  },
  useHandoff: async (s: Session) => {
    const { error } = await sb.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
    if (error) throw toError(error);
  },
  deleteAccount: () => fn<{ deleted: boolean }>("delete-account", {}),

  staffStats: () => rpc<Record<string, any>>("staff_stats"),
  staffSearch: (q: string) => rpc<{ users: any[]; orgs: any[] }>("staff_search", { q }),
  staffUser: (uid: string) => rpc<Record<string, any>>("staff_user", { uid }),
  staffOrg: (org: string) => rpc<Record<string, any>>("staff_org", { org }),
  staffSetPlan: (org: string, plan: string, trial_days: number | null) => rpc<void>("staff_set_plan", { org, plan, trial_days }),
  staffSetUserPlan: (uid: string, plan: string) => rpc<void>("staff_set_user_plan", { uid, plan }),
  staffSuspendOrg: (org: string, suspended: boolean, reason: string) => rpc<void>("staff_suspend_org", { org, suspended, reason }),
  staffSuspendUser: (uid: string, suspended: boolean, reason: string) => rpc<void>("staff_suspend_user", { uid, suspended, reason }),
  staffDeleteUser: (user_id: string) => fn<{ deleted: boolean }>("staff-delete-user", { user_id }),
};

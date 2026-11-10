import type { ComponentType } from "preact";
import { useEffect } from "preact/hooks";
import { LocationProvider, Route, Router, useLocation, useRoute } from "preact-iso";
import { SessionProvider, useSession } from "./lib/session";
import { withNext } from "./lib/nav";
import { api } from "./lib/api";
import { Overlays } from "./ui/overlay";
import { Shell } from "./ui/shell";
import { AuthLayout } from "./ui/auth";
import { Button, Page, Skeleton } from "./ui/kit";
import { Forgot, Reset, SignIn, SignUp, Verify } from "./pages/auth";
import { AppLogin, Handoff, InviteLanding } from "./pages/connect";
import { Account, Computers, YourData } from "./pages/account";
import { MyCloud } from "./pages/mycloud";
import { NewOrg, OrgOverview, OrgPlan, OrgSettings } from "./pages/org";
import { Members } from "./pages/members";
import { Spaces } from "./pages/spaces";
import { OrgProjects } from "./pages/projects";
import { Staff, StaffOrg, StaffUser } from "./pages/staff";

function Splash() {
  return (
    <div class="splash" aria-busy="true">
      <span class="hud">NativeCloud</span>
    </div>
  );
}

function Private({ page: P }: { page: ComponentType }) {
  const { ready, session, problem, signOut } = useSession();
  const { route, url } = useLocation();
  useEffect(() => {
    if (ready && !session) route(withNext("/sign-in", url), true);
  }, [ready, session]);
  if (!ready || !session) return <Splash />;
  if (problem) {
    const suspended = problem.head === "suspended";
    return (
      <AuthLayout title={suspended ? "Account suspended" : "Something went wrong"} eyebrow="NativeCloud">
        <p class="sec">{problem.message}</p>
        <Button kind="ghost" block onClick={() => signOut()}>
          Sign out
        </Button>
      </AuthLayout>
    );
  }
  return (
    <Shell>
      <P />
    </Shell>
  );
}

const guard = (P: ComponentType) => () => <Private page={P} />;

function Home() {
  const { me } = useSession();
  const { route } = useLocation();
  useEffect(() => {
    if (!me) return;
    let last = "";
    try {
      last = localStorage.getItem("nativecloud-last-org") ?? "";
    } catch {
      last = "";
    }
    const org = me.orgs.find((o) => o.slug === last) ?? me.orgs[0];
    route(org ? `/o/${org.slug}` : "/me", true);
  }, [me]);
  return <Skeleton rows={4} />;
}

function OpenProject() {
  const { params } = useRoute();
  const { me } = useSession();
  const { route } = useLocation();
  useEffect(() => {
    if (!me || !params.id) return;
    api
      .project(params.id)
      .then(async (p) => {
        if (p.workspace_id === me.personal_workspace) return route(`/me?open=${p.id}`, true);
        for (const o of me.orgs) {
          const spaces = await api.spaces(o.id);
          if (spaces.some((s) => s.id === p.workspace_id)) return route(`/o/${o.slug}/projects?open=${p.id}`, true);
        }
        route("/me", true);
      })
      .catch(() => route("/me", true));
  }, [me, params.id]);
  return <Skeleton rows={4} />;
}

function NotFound() {
  const { session } = useSession();
  if (!session) {
    return (
      <AuthLayout title="Not here" eyebrow="NativeCloud / 404">
        <p class="sec">That page doesn't exist.</p>
        <a class="btn btn--primary btn--block" href="/">
          Open NativeCloud
        </a>
      </AuthLayout>
    );
  }
  return (
    <Shell>
      <Page title="Not here" sub="That page doesn't exist, or you don't have access to it.">
        <div class="actions">
          <a class="btn btn--primary btn--sm" href="/">
            Go home
          </a>
        </div>
      </Page>
    </Shell>
  );
}

export function App() {
  return (
    <LocationProvider>
      <SessionProvider>
        <Router>
          <Route path="/sign-in" component={SignIn} />
          <Route path="/sign-up" component={SignUp} />
          <Route path="/verify" component={Verify} />
          <Route path="/forgot" component={Forgot} />
          <Route path="/reset" component={Reset} />
          <Route path="/login" component={AppLogin} />
          <Route path="/auth/handoff" component={Handoff} />
          <Route path="/invite/:id" component={InviteLanding} />
          <Route path="/" component={guard(Home)} />
          <Route path="/me" component={guard(MyCloud)} />
          <Route path="/p/:id" component={guard(OpenProject)} />
          <Route path="/account" component={guard(Account)} />
          <Route path="/account/computers" component={guard(Computers)} />
          <Route path="/account/data" component={guard(YourData)} />
          <Route path="/new" component={guard(NewOrg)} />
          <Route path="/o/:slug" component={guard(OrgOverview)} />
          <Route path="/o/:slug/projects" component={guard(OrgProjects)} />
          <Route path="/o/:slug/spaces" component={guard(Spaces)} />
          <Route path="/o/:slug/members" component={guard(Members)} />
          <Route path="/o/:slug/plan" component={guard(OrgPlan)} />
          <Route path="/o/:slug/settings" component={guard(OrgSettings)} />
          <Route path="/staff" component={guard(Staff)} />
          <Route path="/staff/users/:id" component={guard(StaffUser)} />
          <Route path="/staff/orgs/:id" component={guard(StaffOrg)} />
          <Route default component={NotFound} />
        </Router>
        <Overlays />
      </SessionProvider>
    </LocationProvider>
  );
}

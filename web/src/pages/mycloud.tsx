import { Block, Meter, Problem, Skeleton } from "../ui/kit";
import { api } from "../lib/api";
import { useLoad } from "../lib/load";
import { useSession } from "../lib/session";
import { bytes, planName } from "../lib/format";
import { ProjectsBrowser } from "./projects";
import { InvitesForYou } from "./account";

export function MyCloud() {
  const { me } = useSession();
  const spaces = useLoad(() => (me ? api.personal(me.id) : Promise.resolve([])), [me?.id]);
  if (!me) return null;
  if (spaces.error) return <Problem error={spaces.error} retry={spaces.reload} />;
  if (!spaces.data) return <Skeleton rows={6} />;
  return (
    <ProjectsBrowser
      spaces={spaces.data}
      writable={() => true}
      eyebrow="Just for you"
      title="My cloud"
      sub="Your own scripts. Nobody else sees them unless you move them into an organization's space."
      top={
        <>
          <InvitesForYou />
          <Block title={`${planName(me.plan.id)} plan`}>
            <div class="grid-2">
              <Meter label="Cloud scripts" used={me.usage.projects} max={me.plan.max_projects} shown={`${me.usage.projects} of ${me.plan.max_projects}`} />
              <Meter label="Storage" used={me.usage.bytes} max={me.plan.max_bytes} shown={`${bytes(me.usage.bytes)} of ${bytes(me.plan.max_bytes)}`} />
            </div>
          </Block>
        </>
      }
    />
  );
}

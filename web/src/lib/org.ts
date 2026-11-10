import { useEffect } from "preact/hooks";
import { useLocation, useRoute } from "preact-iso";
import { api, type Org } from "./api";
import { useLoad, type Loaded } from "./load";

export function useOrg(): Loaded<Org> & { slug: string } {
  const { params } = useRoute();
  const { path, route } = useLocation();
  const slug = params.slug ?? "";
  const org = useLoad(() => api.orgBySlug(slug), [slug]);
  useEffect(() => {
    const o = org.data;
    if (!o) return;
    try {
      localStorage.setItem("nativecloud-last-org", o.slug);
    } catch {
      return;
    }
    if (o.slug !== slug) route(path.replace(`/o/${slug}`, `/o/${o.slug}`), true);
  }, [org.data]);
  return { ...org, slug };
}

export const manages = (o: Org | undefined): boolean => o?.role === "owner" || o?.role === "admin";

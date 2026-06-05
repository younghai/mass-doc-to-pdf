import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export function useSession() {
  const q = useQuery({ queryKey: ["session"], queryFn: () => api.session(), retry: false });
  const user = q.data?.user && q.data.user.email ? q.data.user : null;
  return { user, isLoading: q.isLoading };
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { loadFeatureFlags, updateFeatureFlag } from "./api";

export function useFeatureFlags() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["featureFlags"],
    queryFn: () => loadFeatureFlags(),
  });
  return { config: data, isLoading, error };
}

export function useEnableFeatureFlag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      featureName,
      enabled,
    }: {
      featureName: string;
      enabled: boolean;
    }) => {
      await updateFeatureFlag(featureName, enabled);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["featureFlags"] });
    },
  });
}

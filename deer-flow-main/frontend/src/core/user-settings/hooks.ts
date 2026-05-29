import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { loadUserUiSettings, updateUserUiSettings } from "./api";

export function useUserUiSettings() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["userUiSettings"],
    queryFn: () => loadUserUiSettings(),
  });
  return { settings: data, isLoading, error };
}

export function useUpdateUserUiSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateUserUiSettings,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["userUiSettings"] });
    },
  });
}

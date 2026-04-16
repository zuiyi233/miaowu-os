import React from "react";
import { useModalStore, ModalConfig } from "./useModalStore";
import { useQueryClient } from "@tanstack/react-query";

export function useCreationModal(
  FormComponent: React.ComponentType<any>,
  title: string,
  description: string,
  queryKeysToInvalidate: any[][] = [["novels"]]
) {
  const { open } = useModalStore();
  const queryClient = useQueryClient();

  const openModal = (extraProps = {}) => {
    const onSubmitSuccess = () => {
      queryKeysToInvalidate.forEach((key) =>
        queryClient.invalidateQueries({ queryKey: key })
      );
    };

    open({
      type: "dialog",
      title: title,
      description: description,
      component: FormComponent,
      props: {
        ...extraProps,
        onSubmitSuccess,
      },
    } as ModalConfig);
  };

  return openModal;
}

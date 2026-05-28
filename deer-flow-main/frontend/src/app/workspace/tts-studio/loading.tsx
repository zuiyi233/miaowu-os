import { Skeleton } from "@/components/ui/skeleton";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";

export default function TtsStudioLoading() {
  return (
    <WorkspaceContainer>
      <WorkspaceHeader />
      <WorkspaceBody className="overflow-hidden">
        <div className="grid size-full grid-cols-[16rem_minmax(0,1fr)_20rem] gap-3 p-3">
          <Skeleton className="h-full w-full" />
          <Skeleton className="h-full w-full" />
          <Skeleton className="h-full w-full" />
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}

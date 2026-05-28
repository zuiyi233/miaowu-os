import { Skeleton } from "@/components/ui/skeleton";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";

export default function ImagesLoading() {
  return (
    <WorkspaceContainer>
      <WorkspaceHeader />
      <WorkspaceBody className="overflow-hidden">
        <div className="mx-auto grid w-full max-w-[1600px] gap-4 p-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
          <div className="space-y-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <Skeleton className="min-h-[34rem] w-full" />
            <Skeleton className="min-h-[34rem] w-full" />
          </div>
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}

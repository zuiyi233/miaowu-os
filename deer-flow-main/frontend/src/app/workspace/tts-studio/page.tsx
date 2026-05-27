"use client";

import { WorkspaceBody, WorkspaceHeader } from "@/components/workspace/workspace-container";
import { TtsStudioWorkspaceView } from "@/components/workspace/tts-studio/tts-studio-workspace";

export default function TtsStudioPage() {
  return (
    <>
      <WorkspaceHeader />
      <WorkspaceBody className="overflow-hidden">
        <TtsStudioWorkspaceView />
      </WorkspaceBody>
    </>
  );
}

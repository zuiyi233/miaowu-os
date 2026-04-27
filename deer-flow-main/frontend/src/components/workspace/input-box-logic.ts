export type FollowupsVisibilityParams = {
  disabled?: boolean;
  isNewThread?: boolean;
  hasPendingClarification: boolean;
  followupsHidden: boolean;
  followupsLoading: boolean;
  followupsCount: number;
};

export function shouldShowFollowups({
  disabled,
  isNewThread,
  hasPendingClarification,
  followupsHidden,
  followupsLoading,
  followupsCount,
}: FollowupsVisibilityParams): boolean {
  return (
    !disabled &&
    !isNewThread &&
    !hasPendingClarification &&
    !followupsHidden &&
    (followupsLoading || followupsCount > 0)
  );
}

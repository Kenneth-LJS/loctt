import { avatarPalette, initials } from "./avatar.ts";

/**
 * A user's avatar chip: the stored image when the user has one, the
 * initials-on-a-palette fallback otherwise. PRU-13 requires the stored
 * avatar to appear "in the header menu, in the assignee cell in the
 * list, and on the task detail panel"; PRU-31 requires every one of
 * those to revert to initials the moment the avatar is removed. Both
 * turn on this single component so the surfaces cannot drift apart.
 *
 * The image is served by `GET /api/users/:id/avatar`; when the profile
 * records no `avatar`, that endpoint 404s, so we decide by the profile
 * field rather than letting a broken <img> flash.
 */
export interface UserAvatarLike {
  readonly id: string;
  readonly name: string;
  readonly avatar?: string | undefined;
}

export interface UserAvatarProps {
  readonly user: UserAvatarLike;
  /** Tailwind size + text classes, e.g. "h-5 w-5 text-[10px]". */
  readonly sizeClass: string;
  /** Extra classes applied to both the img and the initials chip. */
  readonly className?: string;
  /** Test id used whichever branch renders. */
  readonly testId?: string;
  /**
   * Test id for the image branch only, and {@link initialsTestId} for
   * the initials branch — for callers (the Settings panel) whose specs
   * assert on *which* branch is showing rather than on a stable id.
   * When set they win over {@link testId} for that branch.
   */
  readonly imageTestId?: string;
  readonly initialsTestId?: string;
}

export function UserAvatar({
  user,
  sizeClass,
  className,
  testId,
  imageTestId,
  initialsTestId,
}: UserAvatarProps) {
  const hasAvatar = typeof user.avatar === "string" && user.avatar.length > 0;
  const shared = [sizeClass, "shrink-0 rounded-full", className ?? ""].join(" ");
  if (hasAvatar) {
    return (
      <img
        src={`/api/users/${encodeURIComponent(user.id)}/avatar`}
        alt=""
        data-testid={imageTestId ?? testId}
        className={`${shared} object-cover`}
      />
    );
  }
  return (
    <span
      data-testid={initialsTestId ?? testId}
      className={`${shared} grid place-items-center font-semibold ${avatarPalette(user.id)}`}
    >
      {initials(user.name)}
    </span>
  );
}

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";

/**
 * Advisory-lock hazard classes (GIT-22). These are the filesystem
 * categories on which POSIX advisory locks — the mechanism the state
 * lock uses (`state/lock.ts`) — are unreliable, so a rekey during git
 * sync can silently fail to serialize. The list is the single source of
 * truth for both the proactive enable-time warning here and the
 * lock-failure message in `state/lock.ts`; do not fork it.
 */
export type SyncFsClass = "icloud" | "dropbox" | "onedrive" | "nfs" | "smb";

/** Human-readable name per class, for the advisory sentence. */
const FS_CLASS_LABEL: Record<SyncFsClass, string> = {
  icloud: "iCloud Drive",
  dropbox: "Dropbox",
  onedrive: "OneDrive",
  nfs: "NFS",
  smb: "SMB",
};

/**
 * What a best-effort filesystem probe can learn about a directory. Both
 * fields are optional: a probe that cannot resolve the real path or read
 * the mount type still returns what it could, and the classifier treats
 * every absent field as "no signal" rather than a negative.
 */
export interface FsProbeResult {
  /** The resolved (symlink-followed) absolute path, for marker matching. */
  readonly resolvedPath?: string;
  /**
   * The mount filesystem type as the OS reports it (e.g. "apfs", "nfs",
   * "smbfs", "cifs"), lowercased. Undefined when it could not be read.
   */
  readonly fstype?: string;
}

/**
 * A filesystem probe. Injected in tests so the only thing mocked is the
 * external OS call (per the testing philosophy: mock the external
 * dependency, never the classification logic). Returns `undefined` when
 * the probe itself could not run at all.
 */
export type FsProbe = (dir: string) => FsProbeResult | undefined;

/**
 * The advisory a caller surfaces. `fsClass` is the machine-readable
 * class (drives `data-git-warning="fstype"` and test hooks); `label` is
 * the human name; `message` is the ready-to-print sentence, worded to
 * match the lock-failure message so a user sees one consistent story.
 */
export interface SyncFsAdvisory {
  readonly fsClass: SyncFsClass;
  readonly label: string;
  readonly message: string;
}

/**
 * Path substrings that identify a sync-folder provider even when the
 * underlying filesystem type is local (apfs/hfs). iCloud, Dropbox and
 * OneDrive all mirror into a normal local directory, so the fstype alone
 * cannot see them — the path is the only signal. Matched
 * case-insensitively against the resolved path.
 */
const PATH_MARKERS: readonly { readonly needle: string; readonly cls: SyncFsClass }[] = [
  // macOS iCloud Drive backing dir, and the user-visible symlink target.
  { needle: "/library/mobile documents/", cls: "icloud" },
  { needle: "com~apple~clouddocs", cls: "icloud" },
  { needle: "/dropbox/", cls: "dropbox" },
  // OneDrive (personal and "OneDrive - <org>") both start "onedrive".
  { needle: "/onedrive", cls: "onedrive" },
];

/**
 * Network filesystem types (as `mount`/`statfs` report them) that break
 * advisory locks. Matched against the probe's `fstype`.
 */
const NETWORK_FSTYPES: readonly { readonly type: string; readonly cls: SyncFsClass }[] = [
  { type: "nfs", cls: "nfs" },
  { type: "smbfs", cls: "smb" },
  { type: "cifs", cls: "smb" },
  { type: "smb", cls: "smb" },
];

/**
 * Classifies a probe result into a hazard class, or `undefined` when
 * nothing matches. Pure: no I/O, no throwing. Path markers win over
 * fstype so a Dropbox folder on apfs is still called "Dropbox" rather
 * than going unrecognised. This is the unit under test.
 */
export function classifySyncFs(probe: FsProbeResult | undefined): SyncFsClass | undefined {
  if (probe === undefined) return undefined;

  const path = probe.resolvedPath?.toLowerCase();
  if (path !== undefined) {
    for (const { needle, cls } of PATH_MARKERS) {
      if (path.includes(needle)) return cls;
    }
  }

  const fstype = probe.fstype?.toLowerCase();
  if (fstype !== undefined) {
    for (const { type, cls } of NETWORK_FSTYPES) {
      // Exact or prefix match: "nfs" also covers "nfs4" as some systems
      // report it; "smbfs"/"cifs" are matched whole.
      if (fstype === type || fstype.startsWith(`${type}.`) || fstype.startsWith(`${type}4`)) {
        return cls;
      }
    }
  }

  return undefined;
}

/**
 * The default probe. Best-effort and silent on any failure: it resolves
 * the real path and asks the OS for the mount type, and if either step
 * throws or yields nothing it returns whatever it did learn (possibly an
 * empty result) rather than propagating. Never throws.
 *
 * The mount type is read by matching the directory against the longest
 * mount point in `mount(8)` output — portable across macOS and Linux,
 * and needing no elevated privileges. The parenthesised/`type=` field of
 * that line carries the fstype.
 */
export const defaultFsProbe: FsProbe = (dir: string): FsProbeResult | undefined => {
  let resolvedPath: string | undefined;
  try {
    resolvedPath = realpathSync(dir);
  } catch {
    resolvedPath = dir;
  }

  let fstype: string | undefined;
  try {
    fstype = readMountFstype(resolvedPath ?? dir);
  } catch {
    fstype = undefined;
  }

  return {
    ...(resolvedPath !== undefined ? { resolvedPath } : {}),
    ...(fstype !== undefined ? { fstype } : {}),
  };
};

/**
 * Reads the filesystem type for the mount that contains `path` by
 * matching against `mount(8)` output. Returns `undefined` when the
 * command is unavailable or nothing matches — the caller degrades to no
 * warning. Not exported: the injectable seam is {@link FsProbe}, and
 * tests exercise {@link classifySyncFs} directly rather than shelling
 * out.
 *
 * `mount` lines look like:
 *   - macOS:  `/dev/disk3s5 on /System/Volumes/Data (apfs, local, …)`
 *   - Linux:  `server:/export on /mnt/share type nfs4 (rw,…)`
 * We take the longest mount point that is a prefix of `path` and read
 * the fstype from that line.
 */
function readMountFstype(path: string): string | undefined {
  const proc = spawnSync("mount", [], { encoding: "utf-8", timeout: 3000 });
  if (proc.status !== 0 || typeof proc.stdout !== "string") return undefined;

  let bestMount = "";
  let bestType: string | undefined;

  for (const line of proc.stdout.split("\n")) {
    // ` on <mountpoint> ` appears on both platforms.
    const onIdx = line.indexOf(" on ");
    if (onIdx === -1) continue;
    const afterOn = line.slice(onIdx + 4);

    // The mount point runs up to the next " (" (macOS) or " type " (Linux).
    const parenIdx = afterOn.indexOf(" (");
    const typeIdx = afterOn.indexOf(" type ");
    const mountEnd = parenIdx === -1
      ? typeIdx
      : typeIdx === -1 ? parenIdx : Math.min(parenIdx, typeIdx);
    if (mountEnd === -1) continue;
    const mountPoint = afterOn.slice(0, mountEnd);

    if (!pathIsUnder(path, mountPoint)) continue;
    if (mountPoint.length < bestMount.length) continue;

    // Extract fstype: Linux "type <fs>", macOS first token inside "(…)".
    let type: string | undefined;
    if (typeIdx !== -1) {
      type = afterOn.slice(typeIdx + 6).split(/[\s(]/)[0];
    } else if (parenIdx !== -1) {
      type = afterOn.slice(parenIdx + 2).split(/[,)\s]/)[0];
    }

    bestMount = mountPoint;
    bestType = type?.toLowerCase();
  }

  return bestType;
}

/** True when `path` is `mountPoint` or lives beneath it. */
function pathIsUnder(path: string, mountPoint: string): boolean {
  if (mountPoint === "/") return true;
  if (path === mountPoint) return true;
  return path.startsWith(`${mountPoint}/`);
}

/**
 * The GIT-22 advisory: given a directory, decide whether it sits on a
 * filesystem where advisory locks are unreliable and, if so, return a
 * ready-to-surface warning naming the class. Returns `undefined` when
 * the probe cannot tell — deliberately: crying wolf on an unknown
 * filesystem is worse than staying silent, and the lock-failure message
 * still covers the case where a lock actually does fail later.
 *
 * Best-effort by construction: the injected probe never throws (the
 * default swallows), and an unrecognised result yields `undefined`.
 */
export function detectSyncFsAdvisory(
  dir: string,
  probe: FsProbe = defaultFsProbe,
): SyncFsAdvisory | undefined {
  let result: FsProbeResult | undefined;
  try {
    result = probe(dir);
  } catch {
    // A misbehaving probe must not turn a safe enable into a crash.
    return undefined;
  }

  const fsClass = classifySyncFs(result);
  if (fsClass === undefined) return undefined;

  const label = FS_CLASS_LABEL[fsClass];
  return {
    fsClass,
    label,
    // Worded to echo the lock-failure message (state/lock.ts) so the user
    // sees one story: the *class* named, *why* it matters, and that they
    // may proceed but a local disk is safer.
    message:
      `This tracker is on ${label}, where POSIX advisory locks are not `
      + "reliable. Git sync can still be enabled, but a key-allocation "
      + "rekey during sync may fail to serialize. For reliable locking, "
      + "move the tracker to a local disk.",
  };
}

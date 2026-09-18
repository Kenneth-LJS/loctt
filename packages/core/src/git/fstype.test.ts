import { describe, expect, it, vi } from "vitest";

import {
  classifySyncFs,
  detectSyncFsAdvisory,
  type FsProbe,
  type FsProbeResult,
} from "./fstype.js";

/**
 * GIT-22: advisory-lock warning by filesystem class. These tests drive
 * the pure classifier and the advisory builder directly, injecting a
 * fake probe so the ONLY thing mocked is the external OS call — the
 * classification logic (business logic) is exercised for real, per the
 * testing philosophy.
 */
describe("classifySyncFs (GIT-22)", () => {
  // @verifies GIT-22
  it("recognises an iCloud Drive path regardless of fstype", () => {
    expect(classifySyncFs({
      resolvedPath: "/Users/ken/Library/Mobile Documents/com~apple~CloudDocs/tracker",
      fstype: "apfs",
    })).toBe("icloud");
  });

  // @verifies GIT-22
  it("recognises a Dropbox path on a local disk", () => {
    expect(classifySyncFs({ resolvedPath: "/Users/ken/Dropbox/work/tracker", fstype: "apfs" }))
      .toBe("dropbox");
  });

  // @verifies GIT-22
  it("recognises a OneDrive path", () => {
    expect(classifySyncFs({ resolvedPath: "/Users/ken/OneDrive - Acme/tracker" }))
      .toBe("onedrive");
  });

  // @verifies GIT-22
  it("recognises an NFS mount by fstype", () => {
    expect(classifySyncFs({ resolvedPath: "/mnt/share/tracker", fstype: "nfs" })).toBe("nfs");
    expect(classifySyncFs({ resolvedPath: "/mnt/share/tracker", fstype: "nfs4" })).toBe("nfs");
  });

  // @verifies GIT-22
  it("recognises an SMB/CIFS mount by fstype", () => {
    expect(classifySyncFs({ resolvedPath: "/Volumes/share", fstype: "smbfs" })).toBe("smb");
    expect(classifySyncFs({ resolvedPath: "/mnt/share", fstype: "cifs" })).toBe("smb");
  });

  // @verifies GIT-22
  it("returns undefined for an ordinary local disk (apfs, no marker)", () => {
    expect(classifySyncFs({ resolvedPath: "/Users/ken/code/tracker", fstype: "apfs" }))
      .toBeUndefined();
  });

  // @verifies GIT-22
  it("returns undefined when the probe could not determine anything", () => {
    expect(classifySyncFs(undefined)).toBeUndefined();
    expect(classifySyncFs({})).toBeUndefined();
  });
});

describe("detectSyncFsAdvisory (GIT-22)", () => {
  const probeReturning = (r: FsProbeResult | undefined): FsProbe => () => r;

  // @verifies GIT-22
  it("produces an advisory naming the class for a hazardous fs", () => {
    const advisory = detectSyncFsAdvisory(
      "/x",
      probeReturning({ resolvedPath: "/Users/ken/Library/Mobile Documents/x", fstype: "apfs" }),
    );
    expect(advisory).toBeDefined();
    expect(advisory?.fsClass).toBe("icloud");
    expect(advisory?.label).toBe("iCloud Drive");
    // The message names the class and the reason (advisory locks).
    expect(advisory?.message).toContain("iCloud Drive");
    expect(advisory?.message).toContain("advisory locks");
  });

  // @verifies GIT-22
  it("produces NO advisory for a local disk (does not cry wolf)", () => {
    expect(detectSyncFsAdvisory("/x", probeReturning({ resolvedPath: "/home/ken/x", fstype: "ext4" })))
      .toBeUndefined();
  });

  // @verifies GIT-22
  it("produces NO advisory when the probe cannot determine the fs", () => {
    expect(detectSyncFsAdvisory("/x", probeReturning(undefined))).toBeUndefined();
    expect(detectSyncFsAdvisory("/x", probeReturning({}))).toBeUndefined();
  });

  // @verifies GIT-22
  it("never throws when the probe itself throws — degrades to no advisory", () => {
    const throwingProbe: FsProbe = () => { throw new Error("probe blew up"); };
    const spy = vi.fn(throwingProbe);
    expect(() => detectSyncFsAdvisory("/x", spy)).not.toThrow();
    expect(detectSyncFsAdvisory("/x", spy)).toBeUndefined();
    expect(spy).toHaveBeenCalled();
  });
});

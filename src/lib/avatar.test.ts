import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock expo-file-system/legacy ──────────────────────────────────────────────
// vi.mock is hoisted — factory must NOT reference outer variables.
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///app/",
  getInfoAsync:    vi.fn(),
  makeDirectoryAsync: vi.fn(),
  writeAsStringAsync: vi.fn(),
  deleteAsync:     vi.fn(),
  EncodingType:    { UTF8: "utf8" },
}));

// ── Mock AsyncStorage ─────────────────────────────────────────────────────────
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem:     vi.fn(),
    setItem:     vi.fn(),
    multiRemove: vi.fn(),
    getAllKeys:   vi.fn(),
    removeItem:  vi.fn(),
  },
}));

vi.mock("expo-image-manipulator", () => ({
  manipulateAsync: vi.fn(),
  SaveFormat: { JPEG: "jpeg" },
}));

vi.mock("./api/data", () => ({
  uploadAvatar:  vi.fn(),
  updateProfile: vi.fn(),
  getAvatar:     vi.fn(),
}));

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

// Import the mocked modules after vi.mock declarations.
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearAvatarCache, migrateAvatarCache } from "./avatar";

const fsMock = vi.mocked(FileSystem);
const asyncMock = vi.mocked(AsyncStorage);

beforeEach(() => {
  vi.clearAllMocks();
  fsMock.getInfoAsync.mockResolvedValue({ exists: true } as any);
  fsMock.makeDirectoryAsync.mockResolvedValue(undefined as any);
  fsMock.writeAsStringAsync.mockResolvedValue(undefined as any);
  fsMock.deleteAsync.mockResolvedValue(undefined as any);
  asyncMock.getItem.mockResolvedValue(null);
  asyncMock.setItem.mockResolvedValue(undefined as any);
  asyncMock.getAllKeys.mockResolvedValue([]);
  asyncMock.multiRemove.mockResolvedValue(undefined as any);
  asyncMock.removeItem.mockResolvedValue(undefined as any);
});

describe("clearAvatarCache", () => {
  it("deletes the avatar-cache directory with idempotent flag", async () => {
    await clearAvatarCache();
    expect(fsMock.deleteAsync).toHaveBeenCalledWith(
      expect.stringContaining("avatar-cache"),
      { idempotent: true },
    );
  });

  it("does not throw when the directory deletion fails", async () => {
    fsMock.deleteAsync.mockRejectedValueOnce(new Error("not found"));
    await expect(clearAvatarCache()).resolves.not.toThrow();
  });
});

describe("migrateAvatarCache", () => {
  it("is a no-op when the migration flag is already set", async () => {
    asyncMock.getItem.mockResolvedValueOnce("1"); // migration flag present
    await migrateAvatarCache();
    expect(fsMock.writeAsStringAsync).not.toHaveBeenCalled();
  });

  it("migrates avatar: keys from AsyncStorage to file system", async () => {
    asyncMock.getItem.mockResolvedValueOnce(null); // no flag → run migration
    asyncMock.getAllKeys.mockResolvedValueOnce(["avatar:user1/avatar.jpg", "other_key"]);
    asyncMock.getItem.mockResolvedValueOnce("data:image/jpeg;base64,abc"); // avatar data
    fsMock.getInfoAsync.mockResolvedValue({ exists: false } as any);

    await migrateAvatarCache();

    expect(fsMock.makeDirectoryAsync).toHaveBeenCalled();
    expect(fsMock.writeAsStringAsync).toHaveBeenCalledWith(
      expect.stringContaining("user1_avatar.jpg"),
      "data:image/jpeg;base64,abc",
      { encoding: "utf8" },
    );
    expect(asyncMock.removeItem).toHaveBeenCalledWith("avatar:user1/avatar.jpg");
    expect(asyncMock.setItem).toHaveBeenCalledWith("rivr.avatar_migration_v1", "1");
  });

  it("skips non-avatar AsyncStorage keys during migration", async () => {
    asyncMock.getItem.mockResolvedValueOnce(null); // no flag
    asyncMock.getAllKeys.mockResolvedValueOnce(["rivr.access", "other_key"]);
    fsMock.getInfoAsync.mockResolvedValue({ exists: false } as any);

    await migrateAvatarCache();

    expect(fsMock.writeAsStringAsync).not.toHaveBeenCalled();
  });
});

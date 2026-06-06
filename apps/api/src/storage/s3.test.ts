import { describe, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFileStorage, S3Storage } from "./s3.js";

describe("S3Storage", () => {
  it("put sends PutObject with key+body, get returns bytes", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({}) // put
      .mockResolvedValueOnce({
        Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
      }); // get
    const s = new S3Storage({ send } as never, "bucket");
    await s.put("k1", Buffer.from("hi"), "application/pdf");
    expect(send).toHaveBeenCalledTimes(1);
    const got = await s.get("k1");
    expect(Buffer.from(got)).toEqual(Buffer.from([1, 2, 3]));
  });
});

describe("LocalFileStorage", () => {
  it("writes nested object keys and reads the exact bytes back", async () => {
    const root = await mkdtemp(join(tmpdir(), "hwptopdf-storage-"));
    try {
      const storage = new LocalFileStorage(root);
      await storage.put("user/src/sample.docx", Buffer.from("doc-bytes"), "application/vnd.openxmlformats");

      const got = await storage.get("user/src/sample.docx");

      expect(Buffer.from(got)).toEqual(Buffer.from("doc-bytes"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects object keys that escape the storage root", async () => {
    const root = await mkdtemp(join(tmpdir(), "hwptopdf-storage-"));
    try {
      const storage = new LocalFileStorage(root);

      await expect(storage.put("../escape.pdf", Buffer.from("x"), "application/pdf")).rejects.toThrow(
        /invalid storage key/,
      );
      await expect(
        storage.put("user/src/123-x/../../../other/out/job.pdf", Buffer.from("x"), "application/pdf"),
      ).rejects.toThrow(/invalid storage key/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

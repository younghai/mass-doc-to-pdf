import { describe, it, expect, vi } from "vitest";
import { S3Storage } from "./s3.js";

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

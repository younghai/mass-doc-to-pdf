import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createReadStream } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import { Readable } from "node:stream";

export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  getStream?(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

function safeObjectPath(root: string, key: string): string {
  if (key.split(/[\\/]+/).some((part) => part === "." || part === "..")) {
    throw new Error(`invalid storage key: ${key}`);
  }
  const normalized = normalize(key);
  if (isAbsolute(normalized) || normalized === ".." || normalized.startsWith(`..${sep}`)) {
    throw new Error(`invalid storage key: ${key}`);
  }
  const path = join(root, normalized);
  const rel = relative(root, path);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`invalid storage key: ${key}`);
  }
  return path;
}

export class LocalFileStorage implements Storage {
  constructor(private readonly root: string) {}

  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    const path = safeObjectPath(this.root, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async get(key: string): Promise<Uint8Array> {
    return readFile(safeObjectPath(this.root, key));
  }

  async getStream(key: string): Promise<Readable> {
    return createReadStream(safeObjectPath(this.root, key));
  }

  async delete(key: string): Promise<void> {
    await unlink(safeObjectPath(this.root, key)).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== "ENOENT") throw err;
    });
  }
}

export class S3Storage implements Storage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<Uint8Array> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!hasByteArrayTransform(res.Body)) {
      throw new Error("S3 object body does not support byte-array reads");
    }
    return res.Body.transformToByteArray();
  }

  async getStream(key: string): Promise<Readable> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (res.Body instanceof Readable) return res.Body;
    if (hasByteArrayTransform(res.Body)) return Readable.from(await res.Body.transformToByteArray());
    throw new Error("S3 object body does not support streaming reads");
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

function hasByteArrayTransform(value: unknown): value is { transformToByteArray(): Promise<Uint8Array> } {
  if (typeof value !== "object" || value === null) return false;
  return typeof Reflect.get(value, "transformToByteArray") === "function";
}

export function makeS3Client(cfg: {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  region?: string;
}): S3Client {
  // forcePathStyle is required for MinIO.
  return new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region ?? "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
  });
}

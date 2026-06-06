import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, sep } from "node:path";

export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
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
    return (res.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
  }
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

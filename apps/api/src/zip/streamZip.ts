import { Readable } from "node:stream";

const ZIP_VERSION = 20;
const UTF8_DATA_DESCRIPTOR_FLAGS = 0x0808;
const STORE_METHOD = 0;
const DOS_TIME = 0;
const DOS_DATE_1980_01_01 = 33;
const UINT32_MAX = 0xffffffff;
const LOCAL_FILE_HEADER_SIZE = 30;
const DATA_DESCRIPTOR_SIZE = 16;
const CENTRAL_DIRECTORY_HEADER_SIZE = 46;
const END_OF_CENTRAL_DIRECTORY_SIZE = 22;

export type ZipSource = {
  readonly name: string;
  readonly open: () => Promise<Readable>;
};

type CentralDirectoryEntry = {
  readonly name: Buffer;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
};

export class ZipSizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipSizeError";
  }
}

export function streamZip(sources: readonly ZipSource[]): Readable {
  return Readable.from(zipChunks(sources));
}

async function* zipChunks(sources: readonly ZipSource[]): AsyncGenerator<Buffer> {
  const centralDirectory: CentralDirectoryEntry[] = [];
  let offset = 0;

  for (const source of sources) {
    const name = Buffer.from(source.name, "utf8");
    const localHeaderOffset = offset;
    const localHeader = localFileHeader(name);
    yield localHeader;
    offset += localHeader.length;

    let crcState = startCrc32();
    let uncompressedSize = 0;
    const input = await source.open();
    for await (const chunk of streamBuffers(input)) {
      crcState = updateCrc32(crcState, chunk);
      uncompressedSize = checkedAddUint32(uncompressedSize, chunk.length, source.name);
      yield chunk;
      offset += chunk.length;
    }

    const crc32 = finishCrc32(crcState);
    const descriptor = dataDescriptor(crc32, uncompressedSize);
    yield descriptor;
    offset += descriptor.length;
    centralDirectory.push({
      name,
      crc32,
      compressedSize: uncompressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
  }

  const centralDirectoryOffset = offset;
  for (const entry of centralDirectory) {
    const header = centralDirectoryHeader(entry);
    yield header;
    offset += header.length;
  }
  const centralDirectorySize = offset - centralDirectoryOffset;
  const end = endOfCentralDirectory(centralDirectory.length, centralDirectorySize, centralDirectoryOffset);
  yield end;
}

async function* streamBuffers(stream: Readable): AsyncGenerator<Buffer> {
  for await (const chunk of stream) {
    if (Buffer.isBuffer(chunk)) {
      yield chunk;
      continue;
    }
    if (chunk instanceof Uint8Array) {
      yield Buffer.from(chunk);
      continue;
    }
    if (typeof chunk === "string") {
      yield Buffer.from(chunk);
      continue;
    }
    throw new Error("ZIP source stream produced an unsupported chunk type");
  }
}

function localFileHeader(name: Buffer): Buffer {
  const header = Buffer.alloc(LOCAL_FILE_HEADER_SIZE + name.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(ZIP_VERSION, 4);
  header.writeUInt16LE(UTF8_DATA_DESCRIPTOR_FLAGS, 6);
  header.writeUInt16LE(STORE_METHOD, 8);
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE_1980_01_01, 12);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(0, 18);
  header.writeUInt32LE(0, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  name.copy(header, LOCAL_FILE_HEADER_SIZE);
  return header;
}

function dataDescriptor(crc32: number, size: number): Buffer {
  const descriptor = Buffer.alloc(DATA_DESCRIPTOR_SIZE);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(crc32, 4);
  descriptor.writeUInt32LE(size, 8);
  descriptor.writeUInt32LE(size, 12);
  return descriptor;
}

function centralDirectoryHeader(entry: CentralDirectoryEntry): Buffer {
  const header = Buffer.alloc(CENTRAL_DIRECTORY_HEADER_SIZE + entry.name.length);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(ZIP_VERSION, 4);
  header.writeUInt16LE(ZIP_VERSION, 6);
  header.writeUInt16LE(UTF8_DATA_DESCRIPTOR_FLAGS, 8);
  header.writeUInt16LE(STORE_METHOD, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE_1980_01_01, 14);
  header.writeUInt32LE(entry.crc32, 16);
  header.writeUInt32LE(entry.compressedSize, 20);
  header.writeUInt32LE(entry.uncompressedSize, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(entry.localHeaderOffset, 42);
  entry.name.copy(header, CENTRAL_DIRECTORY_HEADER_SIZE);
  return header;
}

function endOfCentralDirectory(entryCount: number, centralDirectorySize: number, centralDirectoryOffset: number): Buffer {
  if (entryCount > 0xffff) throw new ZipSizeError("ZIP64 is not supported for more than 65535 entries");
  const end = Buffer.alloc(END_OF_CENTRAL_DIRECTORY_SIZE);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entryCount, 8);
  end.writeUInt16LE(entryCount, 10);
  end.writeUInt32LE(centralDirectorySize, 12);
  end.writeUInt32LE(centralDirectoryOffset, 16);
  end.writeUInt16LE(0, 20);
  return end;
}

function checkedAddUint32(current: number, increment: number, name: string): number {
  const next = current + increment;
  if (next > UINT32_MAX) throw new ZipSizeError(`ZIP64 is not supported for entry ${name}`);
  return next;
}

function startCrc32(): number {
  return UINT32_MAX;
}

function finishCrc32(state: number): number {
  return (state ^ UINT32_MAX) >>> 0;
}

function updateCrc32(state: number, chunk: Buffer): number {
  let crc = state;
  for (const byte of chunk) {
    crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0);
  }
  return crc >>> 0;
}

const CRC32_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC32_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC32_TABLE[index] = value >>> 0;
}

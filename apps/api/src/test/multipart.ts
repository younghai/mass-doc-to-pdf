type MultipartPayloadOptions = {
  readonly fileField?: string;
  readonly fields?: Readonly<Record<string, string>>;
};

/** Build a minimal multipart/form-data payload for app.inject(). */
export function multipartPayload(filename: string, content: Buffer, options: MultipartPayloadOptions = {}) {
  const boundary = "----testboundary";
  const fileField = options.fileField ?? "file";
  const fields = Object.entries(options.fields ?? {}).map(([name, value]) =>
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`),
  );
  const body = Buffer.concat([
    ...fields,
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

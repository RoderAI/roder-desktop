import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type ImageAttachmentFile = {
  name: string;
  path: string;
  type: string;
  size: number;
  imageUrl: string;
};

export async function savePngAttachment(
  data: Buffer,
  filePrefix: string,
  tempDirName: string,
): Promise<ImageAttachmentFile> {
  const dir = join(tmpdir(), tempDirName);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const name = `${filePrefix}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.png`;
  const path = join(dir, name);
  await writeFile(path, data, { mode: 0o600, flag: "wx" });
  return {
    name,
    path,
    type: "image/png",
    size: data.byteLength,
    imageUrl: `data:image/png;base64,${data.toString("base64")}`,
  };
}

export function savePngDataUrl(dataUrl: string, filePrefix: string, tempDirName: string): Promise<ImageAttachmentFile> {
  const prefix = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefix)) throw new Error("Image attachment must be a PNG data URL");
  return savePngAttachment(Buffer.from(dataUrl.slice(prefix.length), "base64"), filePrefix, tempDirName);
}

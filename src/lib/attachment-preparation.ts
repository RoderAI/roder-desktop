export class AttachmentPreparation {
  pending = 0;
  #generation = 0;

  get generation(): number {
    return this.#generation;
  }

  invalidate(): void {
    this.#generation += 1;
    this.pending = 0;
  }

  async prepare<T, R>(
    items: T[],
    prepareItem: (item: T) => Promise<R>,
  ): Promise<{ attachments: R[]; errors: string[] } | null> {
    const generation = this.#generation;
    this.pending += items.length;
    try {
      const results = await Promise.allSettled(items.map((item) => Promise.resolve().then(() => prepareItem(item))));
      if (generation !== this.#generation) return null;
      return {
        attachments: results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
        errors: results.flatMap((result) =>
          result.status === "rejected"
            ? [result.reason instanceof Error ? result.reason.message : "Could not prepare attachment"]
            : [],
        ),
      };
    } finally {
      if (generation === this.#generation) this.pending -= items.length;
    }
  }
}

export function attachmentImageType(file: { name: string; type: string }): string | undefined {
  if (file.type.startsWith("image/")) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    heic: "image/heic",
    heif: "image/heif",
    avif: "image/avif",
    bmp: "image/bmp",
    tif: "image/tiff",
    tiff: "image/tiff",
    svg: "image/svg+xml",
    ico: "image/x-icon",
  };
  return extension ? types[extension] : undefined;
}

export function mergeAttachments<T extends { path: string }>(current: T[], incoming: T[]): T[] {
  const seen = new Set(current.map((attachment) => attachment.path));
  return [
    ...current,
    ...incoming.filter((attachment) => {
      if (!attachment.path || seen.has(attachment.path)) return false;
      seen.add(attachment.path);
      return true;
    }),
  ];
}

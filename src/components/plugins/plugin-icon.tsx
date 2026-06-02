import * as React from "react";
import { Package } from "lucide-react";

export function PluginIcon({ src, alt }: { src: string | undefined; alt: string }): React.JSX.Element {
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const failed = src === failedSrc;

  return (
    <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted/40 text-muted-foreground">
      {src && !failed ? (
        <img src={src} alt={alt} className="size-9" loading="lazy" onError={() => setFailedSrc(src)} />
      ) : (
        <Package className="size-8" />
      )}
    </span>
  );
}

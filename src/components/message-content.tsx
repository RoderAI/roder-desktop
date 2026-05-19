import { isValidElement, type ReactNode } from "react";
import { harden } from "rehype-harden";
import { defaultRehypePlugins, Streamdown, type Components, type StreamdownProps } from "streamdown";
import { cn } from "@/lib/utils";

type MessageContentProps = {
  isStreaming?: boolean;
  text: string;
};

const safeRehypePlugins: StreamdownProps["rehypePlugins"] = [
  defaultRehypePlugins.sanitize,
  [
    harden,
    {
      allowedProtocols: ["http", "https", "mailto"],
      allowedLinkPrefixes: ["http://", "https://", "mailto:"],
      allowedImagePrefixes: [],
      allowDataImages: false,
    },
  ],
];

const markdownComponents: Components = {
  p({ children, className, ...props }) {
    const isCodeLabel = isInlineCodeOnly(children);
    return (
      <p className={cn(className, isCodeLabel && "message-code-label")} {...props}>
        {children}
      </p>
    );
  },
  blockquote({ children, ...props }) {
    return (
      <blockquote className="border-l-2 border-border pl-4 text-muted-foreground" {...props}>
        {children}
      </blockquote>
    );
  },
  inlineCode({ children, className, ...props }) {
    return (
      <code className={cn(className, "message-inline-code rounded-md px-1.5 py-0.5 text-[1em] text-foreground")} {...props}>
        {children}
      </code>
    );
  },
  h1({ children, className, ...props }) {
    return (
      <h1 className={cn(className, "message-heading text-[1em] font-semibold leading-[inherit]")} {...props}>
        {children}
      </h1>
    );
  },
  h2({ children, className, ...props }) {
    return (
      <h2 className={cn(className, "message-heading text-[1em] font-semibold leading-[inherit]")} {...props}>
        {children}
      </h2>
    );
  },
  h3({ children, className, ...props }) {
    return (
      <h3 className={cn(className, "message-heading text-[1em] font-semibold leading-[inherit]")} {...props}>
        {children}
      </h3>
    );
  },
  h4({ children, className, ...props }) {
    return (
      <h4 className={cn(className, "message-heading text-[1em] font-semibold leading-[inherit]")} {...props}>
        {children}
      </h4>
    );
  },
  h5({ children, className, ...props }) {
    return (
      <h5 className={cn(className, "message-heading text-[1em] font-semibold leading-[inherit]")} {...props}>
        {children}
      </h5>
    );
  },
  h6({ children, className, ...props }) {
    return (
      <h6 className={cn(className, "message-heading text-[1em] font-semibold leading-[inherit]")} {...props}>
        {children}
      </h6>
    );
  },
};

function isInlineCodeOnly(children: ReactNode): boolean {
  const meaningfulChildren = Array.isArray(children)
    ? children.filter((child) => !(typeof child === "string" && child.trim() === ""))
    : [children];
  return meaningfulChildren.length === 1 && isValidElement<{ className?: string }>(meaningfulChildren[0])
    && typeof meaningfulChildren[0].props.className === "string"
    && meaningfulChildren[0].props.className.includes("message-inline-code");
}

export function MessageContent({ isStreaming = false, text }: MessageContentProps): React.JSX.Element {
  return (
    <Streamdown
      caret="block"
      className="message-markdown font-medium text-[17px] leading-[1.55]"
      components={markdownComponents}
      controls={{ code: { copy: true, download: false }, table: { copy: true, download: false, fullscreen: false } }}
      isAnimating={isStreaming}
      lineNumbers={false}
      mode={isStreaming ? "streaming" : "static"}
      rehypePlugins={safeRehypePlugins}
    >
      {text}
    </Streamdown>
  );
}

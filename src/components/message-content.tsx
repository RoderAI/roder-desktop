import { Children, isValidElement, useMemo, type ReactNode } from "react";
import { harden } from "rehype-harden";
import { defaultRehypePlugins, Streamdown, type Components, type StreamdownProps } from "streamdown";
import { createSkillTokenRehypePlugin, SkillTokenPill, skillNameFromExactToken } from "@/components/skill-token-pill";
import { cn } from "@/lib/utils";
import type { SkillDescriptor } from "@/types/roder";

type MessageContentProps = {
  isStreaming?: boolean;
  skills?: SkillDescriptor[];
  text: string;
};

const emptySkills: SkillDescriptor[] = [];

const safeRehypePlugins: NonNullable<StreamdownProps["rehypePlugins"]> = [
  defaultRehypePlugins.sanitize,
  [
    harden,
    {
      defaultOrigin: "https://roder.local",
      allowedProtocols: ["http", "https", "mailto"],
      allowedLinkPrefixes: ["http://", "https://", "mailto:"],
      allowedImagePrefixes: [],
      allowDataImages: false,
    },
  ],
];

function createMarkdownComponents(skills: SkillDescriptor[]): Components {
  return {
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
    ul({ children, className, ...props }) {
      return (
        <ul className={cn(className, "message-list message-list-unordered")} {...props}>
          {children}
        </ul>
      );
    },
    ol({ children, className, ...props }) {
      return (
        <ol className={cn(className, "message-list message-list-ordered")} {...props}>
          {children}
        </ol>
      );
    },
    li({ children, className, ...props }) {
      return (
        <li className={cn(className, "message-list-item")} {...props}>
          {children}
        </li>
      );
    },
    inlineCode({ children, className, ...props }) {
      // Rehype handles bare $skill text; this branch handles backticked `$skill`.
      const childText = singleStringChild(children);
      const skillName = childText ? skillNameFromExactToken(childText, skills) : null;
      if (skillName) {
        return <SkillTokenPill name={skillName} />;
      }

      return (
        <code
          className={cn(className, "message-inline-code rounded-md px-1.5 py-0.5 text-[1em] text-foreground")}
          {...props}
        >
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
    "skill-token"({ name }) {
      return <SkillTokenPill name={typeof name === "string" ? name : ""} />;
    },
  };
}

function singleStringChild(children: ReactNode): string | null {
  const childArray = Children.toArray(children);
  const child = childArray.length === 1 ? childArray[0] : null;
  return typeof child === "string" ? child : null;
}

function isInlineCodeOnly(children: ReactNode): boolean {
  const meaningfulChildren = Array.isArray(children)
    ? children.filter((child) => !(typeof child === "string" && child.trim() === ""))
    : [children];
  return (
    meaningfulChildren.length === 1 &&
    isValidElement<{ className?: string }>(meaningfulChildren[0]) &&
    typeof meaningfulChildren[0].props.className === "string" &&
    meaningfulChildren[0].props.className.includes("message-inline-code")
  );
}

export function MessageContent({
  isStreaming = false,
  skills = emptySkills,
  text,
}: MessageContentProps): React.JSX.Element {
  const rehypePlugins = useMemo<StreamdownProps["rehypePlugins"]>(
    () => (skills.length > 0 ? [...safeRehypePlugins, createSkillTokenRehypePlugin(skills)] : safeRehypePlugins),
    [skills],
  );
  const components = useMemo(() => createMarkdownComponents(skills), [skills]);

  return (
    <Streamdown
      className="message-markdown font-medium text-base leading-[1.55]"
      components={components}
      controls={{ code: { copy: true, download: false }, table: { copy: true, download: false, fullscreen: false } }}
      isAnimating={isStreaming}
      lineNumbers={false}
      mode={isStreaming ? "streaming" : "static"}
      rehypePlugins={rehypePlugins}
    >
      {text}
    </Streamdown>
  );
}

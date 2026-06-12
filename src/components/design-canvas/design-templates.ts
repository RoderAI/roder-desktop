import type { DesignPatchOperation, RoderDesignNode } from "@/types/roder";
import type { DesignTemplate, DesignTemplateId, InsertKind, NodeDraft } from "./design-canvas-types";
import { DESIGN_TEMPLATES } from "./design-canvas-types";
import { isRecord } from "./design-canvas-utils";

export function designTemplateById(templateId: DesignTemplateId): DesignTemplate {
  return DESIGN_TEMPLATES.find((template) => template.id === templateId) ?? DESIGN_TEMPLATES[0];
}

export function buildDesignTemplate(
  template: DesignTemplate,
  parentId: string | null,
  offset: number,
): { rootId: string; operations: DesignPatchOperation[] } {
  const rootId = crypto.randomUUID();
  const x = 64 + offset;
  const y = 64 + offset;
  const operations: DesignPatchOperation[] = [];
  const children: RoderDesignNode[] = [];
  const root =
    template.id === "hero"
      ? heroTemplateRoot(rootId, parentId, x, y)
      : template.id === "form"
        ? formTemplateRoot(rootId, parentId, x, y)
        : cardTemplateRoot(rootId, parentId, x, y);

  const addChild = (node: RoderDesignNode): void => {
    const labelNode = templateNestedLabelNode(node);
    children.push(node);
    operations.push({ op: "insert_node", parentId: root.id, node });
    if (labelNode) {
      operations.push({ op: "insert_node", parentId: node.id, node: labelNode });
    }
  };

  if (template.id === "hero") {
    addChild(templateText("Hero headline", root.id, 32, 28, 460, 52, "Build interfaces with Roder", 32, 700));
    addChild(
      templateText(
        "Hero copy",
        root.id,
        34,
        92,
        420,
        54,
        "Use this editable template as a starting point for agent-generated product screens.",
        16,
        400,
      ),
    );
    addChild(templateButton("Primary CTA", root.id, 34, 168, 150, 44, "Start designing"));
    addChild(templateButton("Secondary CTA", root.id, 200, 168, 130, 44, "View library", "#ffffff", "#18181b"));
  } else if (template.id === "form") {
    addChild(templateText("Form title", root.id, 24, 22, 240, 36, "Welcome back", 24, 700));
    addChild(templateText("Email label", root.id, 24, 78, 220, 24, "Email", 13, 600));
    addChild(templateField("Email field", root.id, 24, 104, 272, 42, "name@example.com"));
    addChild(templateText("Password label", root.id, 24, 162, 220, 24, "Password", 13, 600));
    addChild(templateField("Password field", root.id, 24, 188, 272, 42, "••••••••"));
    addChild(templateButton("Submit button", root.id, 24, 252, 272, 44, "Sign in"));
  } else {
    addChild({
      ...designNodeForInsert("icon", 1, 0, root.id, { x: 24, y: 24, width: 44, height: 44 }),
      name: "Feature icon",
      fill: { kind: "color", value: "#4f46e5" },
    });
    addChild(templateText("Card title", root.id, 24, 84, 260, 34, "Agent-ready component", 20, 700));
    addChild(
      templateText(
        "Card copy",
        root.id,
        24,
        124,
        260,
        58,
        "Convert this card into a reusable component, then create instances with local overrides.",
        14,
        400,
      ),
    );
  }

  root.childIds = children.map((child) => child.id);
  operations.unshift({ op: "insert_node", parentId, node: root });
  return { rootId, operations };
}

export function heroTemplateRoot(id: string, parentId: string | null, x: number, y: number): RoderDesignNode {
  return templateFrame(id, parentId, "Hero section", x, y, 560, 260, "#eef2ff");
}

export function formTemplateRoot(id: string, parentId: string | null, x: number, y: number): RoderDesignNode {
  return templateFrame(id, parentId, "Sign-in form", x, y, 320, 328, "#ffffff");
}

export function cardTemplateRoot(id: string, parentId: string | null, x: number, y: number): RoderDesignNode {
  return templateFrame(id, parentId, "Feature card", x, y, 320, 220, "#ffffff");
}

export function templateFrame(
  id: string,
  parentId: string | null,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
): RoderDesignNode {
  return {
    id,
    type: "frame",
    name,
    parentId,
    childIds: [],
    x,
    y,
    width,
    height,
    visible: true,
    cornerRadius: 24,
    fill: { kind: "color", value: fill },
    stroke: { kind: "color", value: "#d4d4d8", width: 1 },
    source: { template: true },
  };
}

export function templateText(
  name: string,
  parentId: string,
  x: number,
  y: number,
  width: number,
  height: number,
  content: string,
  fontSize: number,
  fontWeight: number,
): RoderDesignNode {
  return {
    id: crypto.randomUUID(),
    type: "text",
    name,
    parentId,
    childIds: [],
    x,
    y,
    width,
    height,
    visible: true,
    content,
    fontSize,
    fontWeight,
    textAlign: "left",
    fill: { kind: "color", value: "#18181b" },
  };
}

export function templateButton(
  name: string,
  parentId: string,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  fill = "#18181b",
  text = "#ffffff",
): RoderDesignNode {
  const buttonId = crypto.randomUUID();
  const labelNode = templateText(`${name} label`, buttonId, 16, 11, Math.max(48, width - 32), 22, label, 14, 700);
  labelNode.fill = { kind: "color", value: text };
  labelNode.textAlign = "center";
  return {
    id: buttonId,
    type: "frame",
    name,
    parentId,
    childIds: [labelNode.id],
    x,
    y,
    width,
    height,
    visible: true,
    cornerRadius: 12,
    fill: { kind: "color", value: fill },
    stroke: { kind: "color", value: fill === "#ffffff" ? "#d4d4d8" : fill, width: 1 },
    source: { templateElement: "button", labelNode },
  };
}

export function templateField(
  name: string,
  parentId: string,
  x: number,
  y: number,
  width: number,
  height: number,
  placeholder: string,
): RoderDesignNode {
  const fieldId = crypto.randomUUID();
  const labelNode = templateText(
    `${name} placeholder`,
    fieldId,
    14,
    10,
    Math.max(48, width - 28),
    22,
    placeholder,
    14,
    400,
  );
  labelNode.fill = { kind: "color", value: "#71717a" };
  return {
    id: fieldId,
    type: "frame",
    name,
    parentId,
    childIds: [labelNode.id],
    x,
    y,
    width,
    height,
    visible: true,
    cornerRadius: 10,
    fill: { kind: "color", value: "#ffffff" },
    stroke: { kind: "color", value: "#d4d4d8", width: 1 },
    source: { templateElement: "input", labelNode },
  };
}

export function templateNestedLabelNode(node: RoderDesignNode): RoderDesignNode | null {
  const source = node.source;
  if (!isRecord(source) || !isRecord(source.labelNode)) {
    return null;
  }
  const labelNode = source.labelNode as RoderDesignNode;
  node.source = { ...source, labelNode: undefined };
  return labelNode;
}

export function designNodeForInsert(
  kind: InsertKind,
  index: number,
  offset: number,
  parentId: string | null,
  rect?: NodeDraft,
): RoderDesignNode {
  const id = crypto.randomUUID();
  const positionOffset = parentId ? Math.min(32 + index * 12, 96) : offset;
  const fallbackX = 40 + positionOffset;
  const fallbackY = 40 + positionOffset;
  if (kind === "text") {
    return {
      id,
      type: "text",
      name: `Text ${index}`,
      parentId,
      childIds: [],
      x: rect?.x ?? 48 + positionOffset,
      y: rect?.y ?? 48 + positionOffset,
      width: rect?.width ?? 220,
      height: rect?.height ?? 48,
      visible: true,
      content: "Text",
      fontSize: 16,
      fontWeight: 500,
      textAlign: "left",
      fill: { kind: "color", value: "#18181b" },
    };
  }
  if (kind === "image") {
    return {
      id,
      type: "image",
      name: `Image ${index}`,
      parentId,
      childIds: [],
      x: rect?.x ?? fallbackX,
      y: rect?.y ?? fallbackY,
      width: rect?.width ?? 240,
      height: rect?.height ?? 160,
      visible: true,
      cornerRadius: 12,
      fill: { kind: "color", value: "#f4f4f5" },
      stroke: { kind: "color", value: "#d4d4d8", width: 1 },
      src: "",
    };
  }
  if (kind === "line") {
    return {
      id,
      type: "line",
      name: `Line ${index}`,
      parentId,
      childIds: [],
      x: rect?.x ?? fallbackX,
      y: rect?.y ?? fallbackY,
      width: rect?.width ?? 160,
      height: rect?.height ?? 80,
      visible: true,
      fill: { kind: "color", value: "transparent" },
      stroke: { kind: "color", value: "#18181b", width: 2 },
    };
  }
  if (kind === "path") {
    return {
      id,
      type: "path",
      name: `Path ${index}`,
      parentId,
      childIds: [],
      x: rect?.x ?? fallbackX,
      y: rect?.y ?? fallbackY,
      width: rect?.width ?? 160,
      height: rect?.height ?? 100,
      visible: true,
      fill: { kind: "color", value: "transparent" },
      stroke: { kind: "color", value: "#18181b", width: 2 },
      pathData: "M 8 80 C 40 8, 120 8, 152 80",
      viewBox: "0 0 160 100",
    };
  }
  if (kind === "icon") {
    return {
      id,
      type: "icon",
      name: `Icon ${index}`,
      parentId,
      childIds: [],
      x: rect?.x ?? fallbackX,
      y: rect?.y ?? fallbackY,
      width: rect?.width ?? 80,
      height: rect?.height ?? 80,
      visible: true,
      fill: { kind: "color", value: "#18181b" },
      stroke: { kind: "color", value: "transparent", width: 0 },
      svg: "M12 2l2.8 6.2 6.7.7-5 4.6 1.4 6.5L12 16.7 6.1 20l1.4-6.5-5-4.6 6.7-.7L12 2z",
      viewBox: "0 0 24 24",
    };
  }
  if (kind === "prompt") {
    return {
      id,
      type: "prompt",
      name: `Prompt ${index}`,
      parentId,
      childIds: [],
      x: rect?.x ?? fallbackX,
      y: rect?.y ?? fallbackY,
      width: rect?.width ?? 280,
      height: rect?.height ?? 160,
      visible: true,
      cornerRadius: 14,
      fill: { kind: "color", value: "#fef3c7" },
      stroke: { kind: "color", value: "#f59e0b", width: 1 },
      prompt: "Describe the design change for Roder...",
    };
  }
  return {
    id,
    type: kind,
    name: `${kind[0]?.toUpperCase() ?? "N"}${kind.slice(1)} ${index}`,
    parentId,
    childIds: [],
    x: rect?.x ?? fallbackX,
    y: rect?.y ?? fallbackY,
    width: rect?.width ?? (kind === "frame" ? 360 : 180),
    height: rect?.height ?? (kind === "frame" ? 240 : 120),
    visible: true,
    cornerRadius: kind === "rectangle" ? 8 : 12,
    fill: { kind: "color", value: kind === "frame" ? "#ffffff" : "#f4f4f5" },
    stroke: { kind: "color", value: "#d4d4d8", width: 1 },
  };
}


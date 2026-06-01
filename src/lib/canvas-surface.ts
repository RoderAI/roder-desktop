export type Point = {
  x: number;
  y: number;
};

export type Stroke = {
  id: string;
  color: string;
  width: number;
  order: number;
  points: Point[];
};

export type CanvasShapeKind = "rectangle" | "ellipse" | "line";

export type CanvasShape = {
  id: string;
  kind: CanvasShapeKind;
  color: string;
  width: number;
  order: number;
  start: Point;
  end: Point;
};

export type CanvasTool = "draw" | "erase" | "select" | CanvasShapeKind;

export type CanvasImage = {
  id: string;
  name: string;
  image: HTMLImageElement;
  objectUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ImageInteraction = {
  kind: "move" | "resize";
  id: string;
  corner?: "nw" | "ne" | "sw" | "se";
  start: Point;
  original: { x: number; y: number; width: number; height: number };
};

export const resizeHandleSize = 10;

export function fitCanvasImageRect({
  imageHeight,
  imageWidth,
  surfaceHeight,
  surfaceWidth,
  offset = 0,
}: {
  imageHeight: number;
  imageWidth: number;
  surfaceHeight: number;
  surfaceWidth: number;
  offset?: number;
}): { x: number; y: number; width: number; height: number } {
  const maxWidth = Math.max(80, surfaceWidth * 0.88);
  const maxHeight = Math.max(80, surfaceHeight * 0.8);
  const ratio = Math.min(1, maxWidth / imageWidth, maxHeight / imageHeight);
  const width = Math.max(64, imageWidth * ratio);
  const height = Math.max(64, imageHeight * ratio);
  return {
    x: Math.max(12, (surfaceWidth - width) / 2 + offset),
    y: Math.max(12, (surfaceHeight - height) / 2 + offset),
    width,
    height,
  };
}

export function hasCanvasContent({
  images,
  shapes,
  strokes,
}: {
  images: readonly unknown[];
  shapes: readonly CanvasShape[];
  strokes: readonly Stroke[];
}): boolean {
  return images.length > 0 || shapes.length > 0 || strokes.some((stroke) => stroke.points.length > 0);
}

export function pointFromClient(clientX: number, clientY: number, element: Element): Point {
  const rect = element.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

export function drawStroke(context: CanvasRenderingContext2D, stroke: Stroke): void {
  if (stroke.points.length === 0) {
    return;
  }
  context.save();
  context.globalCompositeOperation = "source-over";
  context.strokeStyle = stroke.color;
  context.lineWidth = stroke.width;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(stroke.points[0].x, stroke.points[0].y);
  for (const point of stroke.points.slice(1)) {
    context.lineTo(point.x, point.y);
  }
  if (stroke.points.length === 1) {
    context.lineTo(stroke.points[0].x + 0.1, stroke.points[0].y + 0.1);
  }
  context.stroke();
  context.restore();
}

export function drawShape(context: CanvasRenderingContext2D, shape: CanvasShape): void {
  context.save();
  context.globalCompositeOperation = "source-over";
  context.strokeStyle = shape.color;
  context.lineWidth = shape.width;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();

  if (shape.kind === "line") {
    context.moveTo(shape.start.x, shape.start.y);
    context.lineTo(shape.end.x, shape.end.y);
  } else {
    const rect = normalizedShapeRect(shape);
    if (shape.kind === "rectangle") {
      context.rect(rect.x, rect.y, rect.width, rect.height);
    } else {
      context.ellipse(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
        rect.width / 2,
        rect.height / 2,
        0,
        0,
        Math.PI * 2,
      );
    }
  }

  context.stroke();
  context.restore();
}

export function canvasBackground(): string {
  return "#ffffff";
}

export function strokeNearPoint(stroke: Stroke, point: Point, radius: number): boolean {
  for (const strokePoint of stroke.points) {
    if (distance(strokePoint, point) <= radius) {
      return true;
    }
  }
  return false;
}

export function loadCanvasImage(file: File): Promise<Omit<CanvasImage, "x" | "y" | "width" | "height">> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({
        id: crypto.randomUUID(),
        name: file.name,
        image,
        objectUrl,
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Could not load image ${file.name}`));
    };
    image.src = objectUrl;
  });
}

export function imageRect(image: CanvasImage): { x: number; y: number; width: number; height: number } {
  return {
    x: image.x,
    y: image.y,
    width: image.width,
    height: image.height,
  };
}

export function imageAtPoint(point: Point, images: CanvasImage[]): CanvasImage | null {
  for (let index = images.length - 1; index >= 0; index -= 1) {
    const image = images[index];
    if (
      point.x >= image.x &&
      point.x <= image.x + image.width &&
      point.y >= image.y &&
      point.y <= image.y + image.height
    ) {
      return image;
    }
  }
  return null;
}

export function hitResizeHandle(point: Point, image: CanvasImage): ImageInteraction["corner"] | null {
  const handles: Array<[ImageInteraction["corner"], Point]> = [
    ["nw", { x: image.x, y: image.y }],
    ["ne", { x: image.x + image.width, y: image.y }],
    ["sw", { x: image.x, y: image.y + image.height }],
    ["se", { x: image.x + image.width, y: image.y + image.height }],
  ];
  for (const [corner, center] of handles) {
    if (Math.abs(point.x - center.x) <= resizeHandleSize && Math.abs(point.y - center.y) <= resizeHandleSize) {
      return corner;
    }
  }
  return null;
}

export function resizeImage(image: CanvasImage, interaction: ImageInteraction, dx: number, dy: number): CanvasImage {
  const aspect = interaction.original.width / interaction.original.height;
  const minSize = 64;
  const nextWidth = Math.max(minSize, resizeWidthFromDrag(interaction, dx, dy, aspect));
  const nextHeight = nextWidth / aspect;
  let nextX = interaction.original.x;
  let nextY = interaction.original.y;

  if (interaction.corner === "sw" || interaction.corner === "nw") {
    nextX = interaction.original.x + interaction.original.width - nextWidth;
  }
  if (interaction.corner === "ne" || interaction.corner === "nw") {
    nextY = interaction.original.y + interaction.original.height - nextHeight;
  }

  return { ...image, x: nextX, y: nextY, width: nextWidth, height: nextHeight };
}

export function drawImageSelection(context: CanvasRenderingContext2D, image: CanvasImage): void {
  context.save();
  context.strokeStyle = "#38bdf8";
  context.lineWidth = 1.5;
  context.setLineDash([6, 4]);
  context.strokeRect(image.x, image.y, image.width, image.height);
  context.setLineDash([]);
  context.fillStyle = "#38bdf8";
  for (const point of [
    { x: image.x, y: image.y },
    { x: image.x + image.width, y: image.y },
    { x: image.x, y: image.y + image.height },
    { x: image.x + image.width, y: image.y + image.height },
  ]) {
    context.fillRect(
      point.x - resizeHandleSize / 2,
      point.y - resizeHandleSize / 2,
      resizeHandleSize,
      resizeHandleSize,
    );
  }
  context.restore();
}

function distance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function resizeWidthFromDrag(interaction: ImageInteraction, dx: number, dy: number, aspect: number): number {
  const fromX =
    interaction.corner === "sw" || interaction.corner === "nw"
      ? interaction.original.width - dx
      : interaction.original.width + dx;
  const fromY =
    interaction.corner === "ne" || interaction.corner === "nw"
      ? (interaction.original.height - dy) * aspect
      : (interaction.original.height + dy) * aspect;
  return Math.abs(fromX - interaction.original.width) >= Math.abs(fromY - interaction.original.width) ? fromX : fromY;
}

function normalizedShapeRect(shape: CanvasShape): { x: number; y: number; width: number; height: number } {
  const x = Math.min(shape.start.x, shape.end.x);
  const y = Math.min(shape.start.y, shape.end.y);
  return {
    x,
    y,
    width: Math.abs(shape.end.x - shape.start.x),
    height: Math.abs(shape.end.y - shape.start.y),
  };
}

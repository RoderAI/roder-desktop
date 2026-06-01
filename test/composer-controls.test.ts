import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { AttachmentChip, ComposerAttachMenuItems } from "../src/components/composer-controls";
import { DropdownMenu, DropdownMenuGroup } from "../src/components/ui/dropdown-menu";

test("image attachments with an image URL render as thumbnails", () => {
  const html = renderToStaticMarkup(
    React.createElement(AttachmentChip, {
      attachment: {
        id: "attachment-1",
        name: "canvas.png",
        path: "/tmp/canvas.png",
        type: "image/png",
        size: 12,
        imageUrl: "data:image/png;base64,YWJj",
        source: "canvas",
      },
      onRemove: () => undefined,
    }),
  );

  expect(html).toContain("<img");
  expect(html).toContain('src="data:image/png;base64,YWJj"');
  expect(html).toContain("canvas.png");
});

test("composer attach menu offers upload and sketch actions", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      DropdownMenu,
      null,
      React.createElement(
        DropdownMenuGroup,
        null,
        React.createElement(ComposerAttachMenuItems, {
          onOpenSketch: () => undefined,
          onUploadFile: () => undefined,
        }),
      ),
    ),
  );

  expect(html).toContain("Upload file");
  expect(html).toContain("Sketch");
});

import { Eye, EyeOff, Frame, ImageIcon, Lock, MessageSquare, Slash, Type, Unlock } from "lucide-react";
import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import type { RoderDesignNode } from "@/types/roder";
import {
  firstMatchingLayerId,
  layerNodeMatches,
  matchingLayerIds,
  normalizeLayerQuery,
} from "./design-canvas-helpers";

export const DesignLayers = memo(DesignLayersImpl);

function DesignLayersImpl({
  nodes,
  onSelectNode,
  onUpdateNode,
  rootIds,
  selectedId,
}: {
  nodes: Record<string, RoderDesignNode>;
  rootIds: string[];
  selectedId: string | null;
  onSelectNode: (id: string) => void;
  onUpdateNode: (nodeId: string, patch: Partial<RoderDesignNode>) => Promise<void>;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const normalizedQuery = normalizeLayerQuery(query);
  const matchingIds = normalizedQuery ? matchingLayerIds(nodes, rootIds, normalizedQuery) : null;
  const visibleRootIds = matchingIds ? rootIds.filter((id) => matchingIds.has(id)) : rootIds;
  const matchCount = matchingIds ? matchingIds.size : Object.keys(nodes).length;
  const firstMatchId = normalizedQuery ? firstMatchingLayerId(nodes, rootIds, normalizedQuery) : null;
  return (
    <section className="flex flex-col gap-1 rounded-lg bg-muted/30 p-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="text-sm font-semibold text-muted-foreground">Layers</div>
        <div className="text-xs text-muted-foreground/80">
          {matchingIds ? `${matchCount} match${matchCount === 1 ? "" : "es"}` : `${Object.keys(nodes).length} nodes`}
        </div>
      </div>
      <div className="flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
        <input
          type="search"
          value={query}
          aria-label="Search layers"
          placeholder="Search layers, types, tokens..."
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && firstMatchId) {
              event.preventDefault();
              onSelectNode(firstMatchId);
            }
          }}
        />
        {firstMatchId && <kbd className="rounded bg-muted px-1 text-[10px] text-muted-foreground">Enter</kbd>}
        {query && (
          <button
            type="button"
            className="rounded px-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => setQuery("")}
          >
            Clear
          </button>
        )}
      </div>
      {visibleRootIds.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-2 py-2 text-xs text-muted-foreground">
          No layers match “{query}”. Try a node name, type, component id, or prompt text.
        </div>
      ) : (
        visibleRootIds.map((id) => {
          const node = nodes[id];
          return node ? (
            <DesignLayerRow
              key={id}
              depth={0}
              node={node}
              nodes={nodes}
              searchQuery={normalizedQuery}
              visibleIds={matchingIds}
              selectedId={selectedId}
              onSelectNode={onSelectNode}
              onUpdateNode={onUpdateNode}
            />
          ) : null;
        })
      )}
    </section>
  );
}

function DesignLayerRow({
  depth,
  node,
  nodes,
  onUpdateNode,
  searchQuery,
  onSelectNode,
  selectedId,
  visibleIds,
}: {
  depth: number;
  node: RoderDesignNode;
  nodes: Record<string, RoderDesignNode>;
  searchQuery: string;
  selectedId: string | null;
  visibleIds: Set<string> | null;
  onSelectNode: (id: string) => void;
  onUpdateNode: (nodeId: string, patch: Partial<RoderDesignNode>) => Promise<void>;
}): React.JSX.Element {
  const visible = node.visible !== false;
  const locked = node.locked === true;
  const directMatch = Boolean(searchQuery && layerNodeMatches(node, searchQuery));
  return (
    <div>
      <div
        className={cn(
          "flex h-7 w-full items-center gap-1 rounded-md px-1 text-sm font-medium hover:bg-accent/60",
          selectedId === node.id && "bg-accent/60 text-foreground",
          directMatch && selectedId !== node.id && "bg-ring/10 text-foreground",
          !visible && "text-muted-foreground/60",
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => onSelectNode(node.id)}
        >
          {node.type === "text" ? (
            <Type className="size-3.5 shrink-0" />
          ) : node.type === "line" ? (
            <Slash className="size-3.5 shrink-0" />
          ) : node.type === "prompt" ? (
            <MessageSquare className="size-3.5 shrink-0" />
          ) : node.type === "image" ? (
            <ImageIcon className="size-3.5 shrink-0" />
          ) : (
            <Frame className="size-3.5 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          {node.type === "component" && (
            <span className="rounded bg-blue-500/10 px-1 text-[10px] font-semibold uppercase text-blue-600">Comp</span>
          )}
          {node.type === "instance" && (
            <span className="rounded bg-violet-500/10 px-1 text-[10px] font-semibold uppercase text-violet-600">
              Inst
            </span>
          )}
        </button>
        <LayerIconButton
          label={visible ? `Hide ${node.name}` : `Show ${node.name}`}
          onClick={() => onUpdateNode(node.id, { visible: !visible })}
        >
          {visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
        </LayerIconButton>
        <LayerIconButton
          label={locked ? `Unlock ${node.name}` : `Lock ${node.name}`}
          onClick={() => onUpdateNode(node.id, { locked: !locked })}
        >
          {locked ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
        </LayerIconButton>
      </div>
      {(node.childIds ?? []).map((id) => {
        if (visibleIds && !visibleIds.has(id)) {
          return null;
        }
        const child = nodes[id];
        return child ? (
          <DesignLayerRow
            key={id}
            depth={depth + 1}
            node={child}
            nodes={nodes}
            searchQuery={searchQuery}
            visibleIds={visibleIds}
            selectedId={selectedId}
            onSelectNode={onSelectNode}
            onUpdateNode={onUpdateNode}
          />
        ) : null;
      })}
    </div>
  );
}

function LayerIconButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => Promise<void>;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        void onClick();
      }}
    >
      {children}
    </button>
  );
}


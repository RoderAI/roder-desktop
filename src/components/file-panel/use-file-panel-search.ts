import { useRef, useState } from "react";
import { fileSearchResultLimit } from "@/components/file-panel/constants";
import type { FileSearchState } from "@/components/file-panel/types";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { filePanelSearchResultLimitSummary, workspaceFilesEntriesToIndexedPaths } from "@/lib/file-panel";
import { roderIpc } from "@/lib/roder-ipc";

export function useFilePanelSearch({
  filesystemAvailable,
  workspaceId,
}: {
  filesystemAvailable: boolean;
  workspaceId: string;
}): {
  search: string;
  searchState: FileSearchState;
  searching: boolean;
  searchResultLimitSummary: string | null;
  searchWorkspaceFiles: (query: string) => void;
} {
  const [search, setSearch] = useState("");
  const [searchState, setSearchState] = useState<FileSearchState>({ status: "idle", query: "", indexedPaths: [] });
  const requestSeq = useRef(0);

  useMountEffect(() => {
    return () => {
      requestSeq.current += 1;
    };
  });

  const searching = Boolean(search.trim());
  const searchResultLimitSummary =
    searchState.status === "ready"
      ? filePanelSearchResultLimitSummary(
          searchState.indexedPaths.length,
          searchState.indexedFileCount,
          fileSearchResultLimit,
        )
      : null;

  function searchWorkspaceFiles(query: string): void {
    setSearch(query);
    const trimmedQuery = query.trim();
    const requestId = (requestSeq.current += 1);
    if (!trimmedQuery || !workspaceId || !filesystemAvailable) {
      setSearchState({ status: "idle", query, indexedPaths: [] });
      return;
    }
    setSearchState((current) => ({
      status: "loading",
      query,
      indexedPaths: current.query === query ? current.indexedPaths : [],
    }));
    void roderIpc
      .queryWorkspaceFiles({ workspaceId, query: trimmedQuery, limit: fileSearchResultLimit })
      .then((result) => {
        if (requestSeq.current !== requestId) {
          return;
        }
        setSearchState({
          status: "ready",
          query,
          indexedPaths: workspaceFilesEntriesToIndexedPaths(result.matches.map((match) => match.entry)),
          indexedFileCount: result.indexedFileCount,
        });
      })
      .catch((error: unknown) => {
        if (requestSeq.current !== requestId) {
          return;
        }
        setSearchState({ status: "error", query, indexedPaths: [], error: errorMessage(error) });
      });
  }

  return { search, searchState, searching, searchResultLimitSummary, searchWorkspaceFiles };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to search files.";
}

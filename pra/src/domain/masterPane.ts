export type MasterPane = { kind: "closed" } | { kind: "new" } | { kind: "edit"; id: string };

export function resolveMasterPane(
  ids: readonly string[],
  selectedId: string | null | undefined,
  creating: boolean,
): MasterPane {
  if (creating) return { kind: "new" };
  if (selectedId && ids.includes(selectedId)) return { kind: "edit", id: selectedId };
  return { kind: "closed" };
}

export function masterShowsForm(pane: MasterPane): boolean {
  return pane.kind !== "closed";
}

export function emptyListCopy(hasQuery: boolean, noun: string): string {
  return hasQuery ? `No ${noun} match that search.` : `No ${noun} yet.`;
}

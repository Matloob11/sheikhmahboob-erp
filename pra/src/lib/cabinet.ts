export function cabinetWarning(isProd: boolean): string {
  return isProd
    ? "Files stay in this browser only. A new Chrome profile or phone is an empty desk — Settings → Import a backup."
    : "Client files stay on this computer.";
}

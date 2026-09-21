import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { Splash } from "./components/Splash";
import { DeskProvider } from "./context/DeskContext";
import { NoticeProvider } from "./context/NoticeContext";
import { bootDesk, exportReadableBackup, type BootOutcome } from "./lib/appBoot";
import { BuyersPage } from "./pages/Buyers";
import { ClientsPage } from "./pages/Clients";
import { DeskPage } from "./pages/Desk";
import { GoLivePage } from "./pages/GoLive";
import { InvoiceEditorPage } from "./pages/InvoiceEditor";
import { InvoicesPage } from "./pages/Invoices";
import { ItemsPage } from "./pages/Items";
import { PosSalePage } from "./pages/PosSale";
import { PsidsPage } from "./pages/Psids";
import { ReportsPage } from "./pages/Reports";
import { ReturnsPage } from "./pages/Returns";
import { PracticeGate, SettingsPage } from "./pages/Settings";
import { TodayPage } from "./pages/Today";

function deskChildRoutes(home: string) {
  return (
    <>
      <Route index element={<DeskPage />} />
      <Route path="today" element={<TodayPage />} />
      <Route path="clients" element={<ClientsPage />} />
      <Route path="clients/:clientId/go-live" element={<GoLivePage />} />
      <Route path="buyers" element={<BuyersPage />} />
      <Route path="items" element={<ItemsPage />} />
      <Route path="invoices" element={<InvoicesPage />} />
      <Route path="invoices/new" element={<InvoiceEditorPage />} />
      <Route path="invoices/:invoiceId" element={<InvoiceEditorPage />} />
      <Route path="reports" element={<ReportsPage />} />
      <Route path="returns" element={<ReturnsPage />} />
      <Route path="psid" element={<PsidsPage />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="pos" element={<PosSalePage />} />
      <Route path="*" element={<Navigate to={home} replace />} />
    </>
  );
}

function BootError({ message }: { message: string }) {
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);

  return (
    <Splash title="Could not open the desk" body={message}>
      <div className="row" style={{ marginTop: 16 }}>
        <button
          className="btn stamp"
          type="button"
          disabled={exporting}
          onClick={() => {
            setExportError("");
            setExporting(true);
            void exportReadableBackup()
              .catch((error) => {
                setExportError(
                  error instanceof Error
                    ? error.message
                    : "Could not export. The browser may have blocked IndexedDB entirely.",
                );
              })
              .finally(() => setExporting(false));
          }}
        >
          {exporting ? "Exporting…" : "Export what can be read"}
        </button>
        <button className="btn ghost" type="button" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
      {exportError ? <p className="alert bad" style={{ marginTop: 12 }}>{exportError}</p> : null}
    </Splash>
  );
}

export default function App() {
  const [boot, setBoot] = useState<BootOutcome | null>(null);

  useEffect(() => {
    let active = true;
    void bootDesk().then((outcome) => {
      if (active) setBoot(outcome);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!boot) {
    return <Splash />;
  }
  if (!boot.ok) {
    return <BootError message={boot.message} />;
  }

  return (
    <NoticeProvider>
      <DeskProvider>
        <PracticeGate>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="pra">{deskChildRoutes("/pra")}</Route>
              {deskChildRoutes("/")}
            </Route>
          </Routes>
        </PracticeGate>
      </DeskProvider>
    </NoticeProvider>
  );
}

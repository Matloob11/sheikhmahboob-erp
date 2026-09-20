import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { computeFileLedger, practiceAttention, returnForPeriod, type FileLedger } from "../domain/ledger";
import { patchSettings } from "../domain/settings";
import { db } from "../db";
import { useLiveState } from "../hooks/useLive";
import { currentPeriod } from "../lib/ids";
import { requestLeave } from "../lib/leaveGate";
import type {
  Client,
  DeskEvent,
  Invoice,
  PsidRecord,
  Purchase,
  ReturnPeriod,
  Settings,
} from "../types";

interface DeskValue {
  ready: boolean;
  settings?: Settings;
  firmName: string;
  period: string;
  clients: Client[];
  client?: Client;
  invoices: Invoice[];
  purchases: Purchase[];
  returns: ReturnPeriod[];
  psids: PsidRecord[];
  events: DeskEvent[];
  ledger?: FileLedger;
  attention: ReturnType<typeof practiceAttention>;
  filing?: ReturnPeriod;
  chooseClient: (id: string) => Promise<void>;
  setPeriod: (period: string) => Promise<void>;
}

const DeskContext = createContext<DeskValue | null>(null);

export function DeskProvider({ children }: { children: ReactNode }) {
  const settingsState = useLiveState(() => db.settings.get("desk"), undefined as Settings | undefined, []);
  const clientsState = useLiveState(() => db.clients.orderBy("businessName").toArray(), [] as Client[], []);
  const settings = settingsState.data;
  const selectedId = settings?.selectedClientId;
  const period = settings?.workingPeriod || currentPeriod();

  const invoicesState = useLiveState(
    () => (selectedId ? db.invoices.where("clientId").equals(selectedId).toArray() : Promise.resolve([] as Invoice[])),
    [] as Invoice[],
    [selectedId],
  );
  const purchasesState = useLiveState(
    () => (selectedId ? db.purchases.where("clientId").equals(selectedId).toArray() : Promise.resolve([] as Purchase[])),
    [] as Purchase[],
    [selectedId],
  );
  const returnsState = useLiveState(
    () => (selectedId ? db.returns.where("clientId").equals(selectedId).toArray() : Promise.resolve([] as ReturnPeriod[])),
    [] as ReturnPeriod[],
    [selectedId],
  );
  const psidsState = useLiveState(
    () => (selectedId ? db.psids.where("clientId").equals(selectedId).toArray() : Promise.resolve([] as PsidRecord[])),
    [] as PsidRecord[],
    [selectedId],
  );
  const failedState = useLiveState(
    () => db.invoices.where("status").equals("failed").toArray(),
    [] as Invoice[],
    [],
  );
  const periodPsidState = useLiveState(
    () => db.psids.where("period").equals(period).toArray(),
    [] as PsidRecord[],
    [period],
  );
  const eventsState = useLiveState(
    () => db.events.orderBy("createdAt").reverse().limit(200).toArray(),
    [] as DeskEvent[],
    [],
  );

  const clients = clientsState.data;
  const invoices = invoicesState.data;
  const purchases = purchasesState.data;
  const returns = returnsState.data;
  const psids = psidsState.data;
  const events = eventsState.data;
  const client = clients.find((row) => row.id === selectedId);

  const ledger = useMemo(
    () =>
      client
        ? computeFileLedger({
            clientId: client.id,
            period,
            invoices,
            purchases,
            psids,
          })
        : undefined,
    [client, period, invoices, purchases, psids],
  );

  const attention = useMemo(() => {
    const active = clients.filter((row) => !row.archived);
    return practiceAttention({
      clients: active,
      invoices: failedState.data,
      psids: periodPsidState.data,
      period,
    });
  }, [clients, failedState.data, periodPsidState.data, period]);

  const filing = client ? returnForPeriod(returns, client.id, period) : undefined;

  const chooseClient = useCallback(async (id: string) => {
    if (!(await requestLeave())) return;
    await patchSettings({ selectedClientId: id });
  }, []);

  const setPeriod = useCallback(async (next: string) => {
    if (!/^\d{4}-\d{2}$/.test(next)) return;
    if (!(await requestLeave())) return;
    await patchSettings({ workingPeriod: next });
  }, []);

  const value = useMemo<DeskValue>(
    () => ({
      ready: settingsState.ready && clientsState.ready,
      settings,
      firmName: settings?.firmName || "My practice",
      period,
      clients,
      client,
      invoices,
      purchases,
      returns,
      psids,
      events,
      ledger,
      attention,
      filing,
      chooseClient,
      setPeriod,
    }),
    [
      settingsState.ready,
      clientsState.ready,
      settings,
      period,
      clients,
      client,
      invoices,
      purchases,
      returns,
      psids,
      events,
      ledger,
      attention,
      filing,
      chooseClient,
      setPeriod,
    ],
  );

  return <DeskContext.Provider value={value}>{children}</DeskContext.Provider>;
}

export function useDesk(): DeskValue {
  const value = useContext(DeskContext);
  if (!value) throw new Error("useDesk must be used inside DeskProvider");
  return value;
}

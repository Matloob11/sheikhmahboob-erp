import { z } from "zod";
import { env } from "../env.js";
import { sealPosTokenForStore } from "../crypto/posToken.js";

const invoiceLineSchema = z
  .object({
    id: z.string(),
    itemCode: z.string().optional(),
    itemName: z.string().optional(),
    quantity: z.number().optional(),
    pctCode: z.string().optional(),
    taxRate: z.number().optional(),
    saleValue: z.number().optional(),
    discount: z.number().optional(),
    furtherTax: z.number().optional(),
    taxCharged: z.number().optional(),
    totalAmount: z.number().optional(),
  })
  .passthrough();

const clientSchema = z
  .object({
    id: z.string().min(1),
    businessName: z.string().optional().default(""),
    brandName: z.string().optional().default(""),
    pntn: z.string().optional().default(""),
    cnic: z.string().optional().default(""),
    phone: z.string().optional().default(""),
    email: z.string().optional().default(""),
    address: z.string().optional().default(""),
    city: z.string().optional().default(""),
    sector: z.string().optional().default(""),
    branchName: z.string().optional().default(""),
    posId: z.string().optional().default(""),
    posToken: z.string().optional().default(""),
    environment: z.string().optional().default("sandbox"),
    notes: z.string().optional().default(""),
    ntn: z.string().optional(),
    personName: z.string().optional(),
    personType: z.string().optional(),
    businessId: z.string().optional(),
    branchId: z.string().optional(),
    stStatus: z.string().optional(),
    registeredOn: z.string().optional(),
    archived: z.boolean().optional(),
    cnicAsRegistration: z.boolean().optional(),
    createdAt: z.number().optional().default(0),
    updatedAt: z.number().optional().default(0),
  })
  .passthrough();

const invoiceSchema = z
  .object({
    id: z.string().min(1),
    clientId: z.string().min(1),
    usin: z.string().optional().default(""),
    invoiceType: z.number().optional().default(1),
    paymentMode: z.number().optional().default(1),
    dateTime: z.string().optional().default(""),
    buyerId: z.string().optional(),
    buyerName: z.string().optional().default(""),
    buyerPntn: z.string().optional().default(""),
    buyerCnic: z.string().optional().default(""),
    buyerPhone: z.string().optional().default(""),
    discount: z.number().optional().default(0),
    furtherTax: z.number().optional().default(0),
    totalQuantity: z.number().optional().default(0),
    totalSaleValue: z.number().optional().default(0),
    totalTaxCharged: z.number().optional().default(0),
    totalBillAmount: z.number().optional().default(0),
    refUsin: z.string().optional().default(""),
    items: z.array(invoiceLineSchema).optional().default([]),
    status: z.string().optional().default("draft"),
    fiscalNumber: z.string().optional().default(""),
    lastError: z.string().optional().default(""),
    lastResponse: z.string().optional().default(""),
    lastCode: z.string().optional().default(""),
    attemptCount: z.number().optional().default(0),
    inFlight: z.boolean().optional(),
    inFlightAt: z.number().optional(),
    postedAt: z.number().optional(),
    postedEnvironment: z.string().optional(),
    postedPosId: z.string().optional(),
    extraTax: z.number().optional(),
    stWithheld: z.number().optional(),
    reverseCharge: z.boolean().optional(),
    saleType: z.string().optional(),
    taxpayerType: z.string().optional(),
    buyerDistrict: z.string().optional(),
    createdAt: z.number().optional().default(0),
    updatedAt: z.number().optional().default(0),
  })
  .passthrough();

export const deskBackupSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    exportedAt: z.number(),
    tokenHandling: z.string().optional(),
    clients: z.array(clientSchema).default([]),
    invoices: z.array(invoiceSchema).default([]),
    purchases: z.array(z.record(z.unknown())).default([]),
    returns: z.array(z.record(z.unknown())).default([]),
    psids: z.array(z.record(z.unknown())).default([]),
    events: z.array(z.record(z.unknown())).optional().default([]),
    buyers: z.array(z.record(z.unknown())).optional().default([]),
    items: z.array(z.record(z.unknown())).optional().default([]),
    pctCodes: z.array(z.record(z.unknown())).optional().default([]),
    clientPlaces: z.array(z.record(z.unknown())).optional().default([]),
    clientBanks: z.array(z.record(z.unknown())).optional().default([]),
    clientPosDevices: z.array(z.record(z.unknown())).optional().default([]),
  })
  .passthrough();

export type DeskBackupInput = z.infer<typeof deskBackupSchema>;

export function periodFromDateTime(dateTime: string): string {
  const match = /^(\d{4}-\d{2})/.exec(dateTime.trim());
  return match?.[1] ?? "";
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function optStr(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optNum(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optBool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export interface ImportSummaryCounts {
  clients: number;
  invoices: number;
  purchases: number;
  returns: number;
  psids: number;
  buyers: number;
  items: number;
  places: number;
  banks: number;
  posDevices: number;
  events: number;
  pctCodes: number;
}

export async function importDeskBackup(
  client: import("pg").PoolClient,
  backup: DeskBackupInput,
  actorUserId: string,
): Promise<ImportSummaryCounts> {
  const { randomUUID } = await import("node:crypto");

  for (const row of backup.clients) {
    const existing = await client.query<{ pos_token: string }>(
      `SELECT pos_token FROM clients WHERE id = $1`,
      [row.id],
    );
    const sealedToken = sealPosTokenForStore(
      row.posToken ?? "",
      existing.rows[0]?.pos_token,
      env.tokenEncryptionKey,
    );

    await client.query(
      `INSERT INTO clients (
        id, business_name, brand_name, pntn, cnic, phone, email, address, city, sector,
        branch_name, pos_id, pos_token, environment, notes, ntn, person_name, person_type,
        business_id, branch_id, st_status, registered_on, archived, cnic_as_registration,
        created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26
      )
      ON CONFLICT (id) DO UPDATE SET
        business_name = EXCLUDED.business_name,
        brand_name = EXCLUDED.brand_name,
        pntn = EXCLUDED.pntn,
        cnic = EXCLUDED.cnic,
        phone = EXCLUDED.phone,
        email = EXCLUDED.email,
        address = EXCLUDED.address,
        city = EXCLUDED.city,
        sector = EXCLUDED.sector,
        branch_name = EXCLUDED.branch_name,
        pos_id = EXCLUDED.pos_id,
        pos_token = EXCLUDED.pos_token,
        environment = EXCLUDED.environment,
        notes = EXCLUDED.notes,
        ntn = EXCLUDED.ntn,
        person_name = EXCLUDED.person_name,
        person_type = EXCLUDED.person_type,
        business_id = EXCLUDED.business_id,
        branch_id = EXCLUDED.branch_id,
        st_status = EXCLUDED.st_status,
        registered_on = EXCLUDED.registered_on,
        archived = EXCLUDED.archived,
        cnic_as_registration = EXCLUDED.cnic_as_registration,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at`,
      [
        row.id,
        row.businessName,
        row.brandName,
        row.pntn,
        row.cnic,
        row.phone,
        row.email,
        row.address,
        row.city,
        row.sector,
        row.branchName,
        row.posId,
        sealedToken,
        row.environment,
        row.notes,
        row.ntn ?? "",
        row.personName ?? "",
        row.personType ?? "",
        row.businessId ?? "",
        row.branchId ?? "",
        row.stStatus ?? "",
        row.registeredOn ?? "",
        row.archived ?? false,
        row.cnicAsRegistration ?? false,
        row.createdAt,
        row.updatedAt,
      ],
    );
  }

  for (const row of backup.clientPlaces ?? []) {
    const id = str(row.id);
    const clientId = str(row.clientId);
    if (!id || !clientId) continue;
    await client.query(
      `INSERT INTO client_places (
        id, client_id, label, address, city, district, province, branch_id, is_primary, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (id) DO UPDATE SET
        client_id = EXCLUDED.client_id,
        label = EXCLUDED.label,
        address = EXCLUDED.address,
        city = EXCLUDED.city,
        district = EXCLUDED.district,
        province = EXCLUDED.province,
        branch_id = EXCLUDED.branch_id,
        is_primary = EXCLUDED.is_primary,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at`,
      [
        id,
        clientId,
        str(row.label),
        str(row.address),
        str(row.city),
        str(row.district),
        str(row.province),
        str(row.branchId),
        bool(row.isPrimary),
        num(row.createdAt),
        num(row.updatedAt),
      ],
    );
  }

  for (const row of backup.clientBanks ?? []) {
    const id = str(row.id);
    const clientId = str(row.clientId);
    if (!id || !clientId) continue;
    await client.query(
      `INSERT INTO client_banks (
        id, client_id, bank_name, account_title, account_no, iban, is_primary, notes, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (id) DO UPDATE SET
        client_id = EXCLUDED.client_id,
        bank_name = EXCLUDED.bank_name,
        account_title = EXCLUDED.account_title,
        account_no = EXCLUDED.account_no,
        iban = EXCLUDED.iban,
        is_primary = EXCLUDED.is_primary,
        notes = EXCLUDED.notes,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at`,
      [
        id,
        clientId,
        str(row.bankName),
        str(row.accountTitle),
        str(row.accountNo),
        str(row.iban),
        bool(row.isPrimary),
        str(row.notes),
        num(row.createdAt),
        num(row.updatedAt),
      ],
    );
  }

  for (const row of backup.clientPosDevices ?? []) {
    const id = str(row.id);
    const clientId = str(row.clientId);
    if (!id || !clientId) continue;
    await client.query(
      `INSERT INTO client_pos_devices (
        id, client_id, place_id, pos_id, label, environment, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (id) DO UPDATE SET
        client_id = EXCLUDED.client_id,
        place_id = EXCLUDED.place_id,
        pos_id = EXCLUDED.pos_id,
        label = EXCLUDED.label,
        environment = EXCLUDED.environment,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at`,
      [
        id,
        clientId,
        optStr(row.placeId),
        str(row.posId),
        str(row.label),
        str(row.environment, "sandbox"),
        num(row.createdAt),
        num(row.updatedAt),
      ],
    );
  }

  for (const row of backup.invoices) {
    const period = periodFromDateTime(row.dateTime);
    await client.query(
      `INSERT INTO invoices (
        id, client_id, period, usin, invoice_type, payment_mode, date_time, buyer_id,
        buyer_name, buyer_pntn, buyer_cnic, buyer_phone, discount, further_tax,
        total_quantity, total_sale_value, total_tax_charged, total_bill_amount, ref_usin,
        items, status, fiscal_number, last_error, last_response, last_code, attempt_count,
        in_flight, in_flight_at, posted_at, posted_environment, posted_pos_id,
        extra_tax, st_withheld, reverse_charge, sale_type, taxpayer_type, buyer_district,
        created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39
      )
      ON CONFLICT (id) DO UPDATE SET
        client_id = EXCLUDED.client_id,
        period = EXCLUDED.period,
        usin = EXCLUDED.usin,
        invoice_type = EXCLUDED.invoice_type,
        payment_mode = EXCLUDED.payment_mode,
        date_time = EXCLUDED.date_time,
        buyer_id = EXCLUDED.buyer_id,
        buyer_name = EXCLUDED.buyer_name,
        buyer_pntn = EXCLUDED.buyer_pntn,
        buyer_cnic = EXCLUDED.buyer_cnic,
        buyer_phone = EXCLUDED.buyer_phone,
        discount = EXCLUDED.discount,
        further_tax = EXCLUDED.further_tax,
        total_quantity = EXCLUDED.total_quantity,
        total_sale_value = EXCLUDED.total_sale_value,
        total_tax_charged = EXCLUDED.total_tax_charged,
        total_bill_amount = EXCLUDED.total_bill_amount,
        ref_usin = EXCLUDED.ref_usin,
        items = EXCLUDED.items,
        status = EXCLUDED.status,
        fiscal_number = EXCLUDED.fiscal_number,
        last_error = EXCLUDED.last_error,
        last_response = EXCLUDED.last_response,
        last_code = EXCLUDED.last_code,
        attempt_count = EXCLUDED.attempt_count,
        in_flight = EXCLUDED.in_flight,
        in_flight_at = EXCLUDED.in_flight_at,
        posted_at = EXCLUDED.posted_at,
        posted_environment = EXCLUDED.posted_environment,
        posted_pos_id = EXCLUDED.posted_pos_id,
        extra_tax = EXCLUDED.extra_tax,
        st_withheld = EXCLUDED.st_withheld,
        reverse_charge = EXCLUDED.reverse_charge,
        sale_type = EXCLUDED.sale_type,
        taxpayer_type = EXCLUDED.taxpayer_type,
        buyer_district = EXCLUDED.buyer_district,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at`,
      [
        row.id,
        row.clientId,
        period,
        row.usin,
        row.invoiceType,
        row.paymentMode,
        row.dateTime,
        row.buyerId ?? null,
        row.buyerName,
        row.buyerPntn,
        row.buyerCnic,
        row.buyerPhone,
        row.discount,
        row.furtherTax,
        row.totalQuantity,
        row.totalSaleValue,
        row.totalTaxCharged,
        row.totalBillAmount,
        row.refUsin,
        JSON.stringify(row.items ?? []),
        row.status,
        row.fiscalNumber,
        row.lastError,
        row.lastResponse,
        row.lastCode,
        row.attemptCount,
        row.inFlight ?? false,
        row.inFlightAt ?? null,
        row.postedAt ?? null,
        row.postedEnvironment ?? null,
        row.postedPosId ?? null,
        row.extraTax ?? null,
        row.stWithheld ?? null,
        row.reverseCharge ?? null,
        row.saleType ?? null,
        row.taxpayerType ?? null,
        row.buyerDistrict ?? null,
        row.createdAt,
        row.updatedAt,
      ],
    );
  }

  for (const row of backup.purchases ?? []) {
    const id = str(row.id);
    const clientId = str(row.clientId);
    if (!id || !clientId) continue;
    await client.query(
      `INSERT INTO purchases (
        id, client_id, period, supplier_name, supplier_pntn, invoice_no, invoice_date,
        sale_value, tax_rate, tax_charged, total_amount, notes, blocked_credit,
        supplier_cnic, pct_code, district, withheld, reverse_charge, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      ON CONFLICT (id) DO UPDATE SET
        client_id = EXCLUDED.client_id,
        period = EXCLUDED.period,
        supplier_name = EXCLUDED.supplier_name,
        supplier_pntn = EXCLUDED.supplier_pntn,
        invoice_no = EXCLUDED.invoice_no,
        invoice_date = EXCLUDED.invoice_date,
        sale_value = EXCLUDED.sale_value,
        tax_rate = EXCLUDED.tax_rate,
        tax_charged = EXCLUDED.tax_charged,
        total_amount = EXCLUDED.total_amount,
        notes = EXCLUDED.notes,
        blocked_credit = EXCLUDED.blocked_credit,
        supplier_cnic = EXCLUDED.supplier_cnic,
        pct_code = EXCLUDED.pct_code,
        district = EXCLUDED.district,
        withheld = EXCLUDED.withheld,
        reverse_charge = EXCLUDED.reverse_charge,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at`,
      [
        id,
        clientId,
        str(row.period),
        str(row.supplierName),
        str(row.supplierPntn),
        str(row.invoiceNo),
        str(row.invoiceDate),
        num(row.saleValue),
        num(row.taxRate),
        num(row.taxCharged),
        num(row.totalAmount),
        str(row.notes),
        bool(row.blockedCredit),
        optStr(row.supplierCnic),
        optStr(row.pctCode),
        optStr(row.district),
        optNum(row.withheld),
        optBool(row.reverseCharge),
        num(row.createdAt),
        optNum(row.updatedAt),
      ],
    );
  }

  for (const row of backup.returns ?? []) {
    const id = str(row.id);
    const clientId = str(row.clientId);
    if (!id || !clientId) continue;
    await client.query(
      `INSERT INTO returns (
        id, client_id, period, status, notes, filed_at, iris_ack, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (id) DO UPDATE SET
        client_id = EXCLUDED.client_id,
        period = EXCLUDED.period,
        status = EXCLUDED.status,
        notes = EXCLUDED.notes,
        filed_at = EXCLUDED.filed_at,
        iris_ack = EXCLUDED.iris_ack,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at`,
      [
        id,
        clientId,
        str(row.period),
        str(row.status, "open"),
        str(row.notes),
        optNum(row.filedAt),
        optStr(row.irisAck),
        num(row.createdAt),
        num(row.updatedAt),
      ],
    );
  }

  for (const row of backup.psids ?? []) {
    const id = str(row.id);
    const clientId = str(row.clientId);
    if (!id || !clientId) continue;
    await client.query(
      `INSERT INTO psids (
        id, client_id, period, amount, head, psid, cpr, bank, paid_on, status, notes,
        due_on, paid_amount, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (id) DO UPDATE SET
        client_id = EXCLUDED.client_id,
        period = EXCLUDED.period,
        amount = EXCLUDED.amount,
        head = EXCLUDED.head,
        psid = EXCLUDED.psid,
        cpr = EXCLUDED.cpr,
        bank = EXCLUDED.bank,
        paid_on = EXCLUDED.paid_on,
        status = EXCLUDED.status,
        notes = EXCLUDED.notes,
        due_on = EXCLUDED.due_on,
        paid_amount = EXCLUDED.paid_amount,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at`,
      [
        id,
        clientId,
        str(row.period),
        num(row.amount),
        str(row.head),
        str(row.psid),
        str(row.cpr),
        str(row.bank),
        str(row.paidOn),
        str(row.status, "planned"),
        str(row.notes),
        optStr(row.dueOn),
        optNum(row.paidAmount),
        num(row.createdAt),
        num(row.updatedAt),
      ],
    );
  }

  for (const row of backup.buyers ?? []) {
    const id = str(row.id);
    const clientId = str(row.clientId);
    if (!id || !clientId) continue;
    await client.query(
      `INSERT INTO buyers (
        id, client_id, name, pntn, cnic, phone, notes, address, district, email, buyer_type,
        created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (id) DO UPDATE SET
        client_id = EXCLUDED.client_id,
        name = EXCLUDED.name,
        pntn = EXCLUDED.pntn,
        cnic = EXCLUDED.cnic,
        phone = EXCLUDED.phone,
        notes = EXCLUDED.notes,
        address = EXCLUDED.address,
        district = EXCLUDED.district,
        email = EXCLUDED.email,
        buyer_type = EXCLUDED.buyer_type,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at`,
      [
        id,
        clientId,
        str(row.name),
        str(row.pntn),
        str(row.cnic),
        str(row.phone),
        str(row.notes),
        optStr(row.address),
        optStr(row.district),
        optStr(row.email),
        optStr(row.buyerType),
        num(row.createdAt),
        num(row.updatedAt),
      ],
    );
  }

  for (const row of backup.items ?? []) {
    const id = str(row.id);
    const clientId = str(row.clientId);
    if (!id || !clientId) continue;
    await client.query(
      `INSERT INTO catalog_items (
        id, client_id, item_code, item_name, pct_code, tax_rate, unit, default_qty, inactive,
        created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (id) DO UPDATE SET
        client_id = EXCLUDED.client_id,
        item_code = EXCLUDED.item_code,
        item_name = EXCLUDED.item_name,
        pct_code = EXCLUDED.pct_code,
        tax_rate = EXCLUDED.tax_rate,
        unit = EXCLUDED.unit,
        default_qty = EXCLUDED.default_qty,
        inactive = EXCLUDED.inactive,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at`,
      [
        id,
        clientId,
        str(row.itemCode),
        str(row.itemName),
        str(row.pctCode),
        num(row.taxRate),
        optStr(row.unit),
        optNum(row.defaultQty),
        bool(row.inactive),
        num(row.createdAt),
        num(row.updatedAt),
      ],
    );
  }

  for (const row of backup.pctCodes ?? []) {
    const id = str(row.id);
    if (!id) continue;
    await client.query(
      `INSERT INTO pct_codes (
        id, pct_code, name, tax_rate, seeded, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (id) DO UPDATE SET
        pct_code = EXCLUDED.pct_code,
        name = EXCLUDED.name,
        tax_rate = EXCLUDED.tax_rate,
        seeded = EXCLUDED.seeded,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at`,
      [
        id,
        str(row.pctCode),
        str(row.name),
        num(row.taxRate),
        bool(row.seeded),
        num(row.createdAt),
        num(row.updatedAt),
      ],
    );
  }

  for (const row of backup.events ?? []) {
    const id = str(row.id);
    if (!id) continue;
    await client.query(
      `INSERT INTO desk_events (id, client_id, kind, title, detail, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET
         client_id = EXCLUDED.client_id,
         kind = EXCLUDED.kind,
         title = EXCLUDED.title,
         detail = EXCLUDED.detail,
         created_at = EXCLUDED.created_at`,
      [
        id,
        optStr(row.clientId),
        str(row.kind),
        str(row.title),
        str(row.detail),
        num(row.createdAt),
      ],
    );
  }

  const counts: ImportSummaryCounts = {
    clients: backup.clients.length,
    invoices: backup.invoices.length,
    purchases: (backup.purchases ?? []).length,
    returns: (backup.returns ?? []).length,
    psids: (backup.psids ?? []).length,
    buyers: (backup.buyers ?? []).length,
    items: (backup.items ?? []).length,
    places: (backup.clientPlaces ?? []).length,
    banks: (backup.clientBanks ?? []).length,
    posDevices: (backup.clientPosDevices ?? []).length,
    events: (backup.events ?? []).length,
    pctCodes: (backup.pctCodes ?? []).length,
  };

  const runId = randomUUID();
  await client.query(
    `INSERT INTO import_runs (
      id, actor_user_id, client_count, invoice_count, purchase_count, return_count,
      psid_count, buyer_count, item_count, place_count, bank_count, pos_device_count,
      event_count, source_exported_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      runId,
      actorUserId,
      counts.clients,
      counts.invoices,
      counts.purchases,
      counts.returns,
      counts.psids,
      counts.buyers,
      counts.items,
      counts.places,
      counts.banks,
      counts.posDevices,
      counts.events,
      backup.exportedAt,
    ],
  );

  await client.query(
    `INSERT INTO audit_events (id, actor_user_id, kind, entity_id, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      randomUUID(),
      actorUserId,
      "import.desk_backup",
      runId,
      JSON.stringify({
        version: backup.version,
        exportedAt: backup.exportedAt,
        ...counts,
      }),
    ],
  );

  return counts;
}

export async function tableCounts(client: import("pg").PoolClient | import("pg").Pool): Promise<
  Record<string, number> & { lastImport: unknown }
> {
  const tables = [
    "clients",
    "invoices",
    "purchases",
    "returns",
    "psids",
    "buyers",
    "catalog_items",
    "pct_codes",
    "client_places",
    "client_banks",
    "client_pos_devices",
    "desk_events",
  ] as const;
  const out: Record<string, number> = {};
  for (const table of tables) {
    const result = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table}`);
    out[table] = Number(result.rows[0]?.count ?? 0);
  }
  const last = await client.query(
    `SELECT id, at, client_count, invoice_count, source_exported_at
     FROM import_runs ORDER BY at DESC LIMIT 1`,
  );
  return { ...out, lastImport: last.rows[0] ?? null };
}

import { BuyerPicker } from "../../components/BuyerPicker";
import { AmountInput, SelectField, TextInput } from "../../components/Field";
import { Panel } from "../../components/Panel";
import { applyBuyerToInvoice, buyerDraftFromInvoice, saveBuyer } from "../../domain/buyers";
import { nextInvoiceStep, type InvoiceStep } from "../../domain/deskChrome";
import { errorForField } from "../../lib/fieldErrors";
import {
  INVOICE_TYPES,
  PAYMENT_MODES,
  type Buyer,
  type Client,
  type Invoice,
  type InvoiceType,
  type PaymentMode,
} from "../../types";

type InvoiceEditorHeaderProps = {
  invoice: Invoice;
  owner: Client;
  buyers: Buyer[];
  errors: string[];
  locked: boolean;
  usinFrozen: boolean;
  stamp: { date: string; time: string };
  pickedBuyer: Buyer | undefined;
  buyerKindLabel: string;
  showAdvanced: boolean;
  step: InvoiceStep;
  onPatch: (partial: Partial<Invoice>) => void;
  onComposeDateTime: (date: string, time: string) => void;
  onSetShowAdvanced: (open: boolean) => void;
  onSetStep: (step: InvoiceStep) => void;
  onPush: (tone: "good" | "bad" | "info", message: string) => void;
};

export function InvoiceEditorHeader({
  invoice,
  owner,
  buyers,
  errors,
  locked,
  usinFrozen,
  stamp,
  pickedBuyer,
  buyerKindLabel,
  showAdvanced,
  step,
  onPatch,
  onComposeDateTime,
  onSetShowAdvanced,
  onSetStep,
  onPush,
}: InvoiceEditorHeaderProps) {
  return (
    <div className="editor-span no-print" id="invoice-header">
      <Panel title="1 · Header">
        <div className="form-grid">
          <TextInput
            id="usin"
            label="USIN"
            className="mono"
            disabled={locked || usinFrozen}
            error={errorForField(errors, "usin")}
            value={invoice.usin}
            onChange={(event) => onPatch({ usin: event.target.value })}
          />
          <TextInput
            id="invoice-date"
            label="Date"
            type="date"
            lang="en-GB"
            disabled={locked}
            error={errorForField(errors, "invoice-date")}
            value={stamp.date}
            onChange={(event) => onComposeDateTime(event.target.value, stamp.time)}
          />
          <TextInput
            label="Time"
            type="time"
            step={1}
            className="mono"
            disabled={locked}
            value={stamp.time.slice(0, 8)}
            onChange={(event) => onComposeDateTime(stamp.date, event.target.value)}
            hint="Stored as YYYY-MM-DD HH:MM:SS"
          />
          <SelectField
            id="invoice-type"
            label="Invoice type"
            disabled={locked}
            error={errorForField(errors, "invoice-type")}
            value={invoice.invoiceType}
            onChange={(event) => onPatch({ invoiceType: Number(event.target.value) as InvoiceType })}
          >
            {INVOICE_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </SelectField>
          <SelectField
            id="payment-mode"
            label="Payment mode"
            disabled={locked}
            error={errorForField(errors, "payment-mode")}
            value={invoice.paymentMode}
            onChange={(event) => onPatch({ paymentMode: Number(event.target.value) as PaymentMode })}
          >
            {PAYMENT_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </SelectField>
          <div className="form-span">
            <BuyerPicker
              buyers={buyers}
              disabled={locked}
              onPick={(buyer) => onPatch(applyBuyerToInvoice(buyer))}
            />
          </div>
          <TextInput
            id="buyer-name"
            label="Buyer name"
            disabled={locked}
            error={errorForField(errors, "buyer-name")}
            value={invoice.buyerName}
            onChange={(event) => onPatch({ buyerName: event.target.value, buyerId: undefined })}
          />
          <TextInput
            id="buyer-pntn"
            label="Buyer PNTN"
            className="mono"
            disabled={locked}
            error={errorForField(errors, "buyer-pntn")}
            value={invoice.buyerPntn}
            onChange={(event) => onPatch({ buyerPntn: event.target.value })}
          />
          <TextInput
            id="buyer-cnic"
            label="Buyer CNIC"
            className="mono"
            disabled={locked}
            error={errorForField(errors, "buyer-cnic")}
            value={invoice.buyerCnic}
            onChange={(event) => onPatch({ buyerCnic: event.target.value })}
          />
          <TextInput
            id="buyer-phone"
            label="Buyer phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            disabled={locked}
            error={errorForField(errors, "buyer-phone")}
            value={invoice.buyerPhone}
            onChange={(event) => onPatch({ buyerPhone: event.target.value })}
          />
          <TextInput
            label="Buyer type"
            disabled
            value={buyerKindLabel}
            hint={pickedBuyer?.buyerType ? "From the buyer master" : "Inferred from PNTN / CNIC"}
            onChange={() => undefined}
          />
        </div>
        <details className="more-fields" open={showAdvanced} onToggle={(event) => onSetShowAdvanced(event.currentTarget.open)}>
          <summary>More header fields</summary>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <TextInput
              label="Sale type"
              disabled={locked}
              value={invoice.saleType ?? "Services"}
              onChange={(event) => onPatch({ saleType: event.target.value })}
            />
            <TextInput
              label="Taxpayer type"
              disabled={locked}
              value={invoice.taxpayerType ?? ""}
              onChange={(event) => onPatch({ taxpayerType: event.target.value })}
            />
            <TextInput
              label="Buyer district"
              disabled={locked}
              value={invoice.buyerDistrict ?? ""}
              onChange={(event) => onPatch({ buyerDistrict: event.target.value })}
            />
            <AmountInput
              label="Extra tax"
              disabled={locked}
              value={invoice.extraTax ?? 0}
              onValueChange={(extraTax) => onPatch({ extraTax })}
            />
            <AmountInput
              label="ST withheld"
              disabled={locked}
              value={invoice.stWithheld ?? 0}
              onValueChange={(stWithheld) => onPatch({ stWithheld })}
            />
            <label className="row form-span">
              <input
                type="checkbox"
                disabled={locked}
                checked={invoice.reverseCharge === true}
                onChange={(event) => onPatch({ reverseCharge: event.target.checked })}
              />
              Reverse charge
            </label>
            <TextInput
              id="header-discount"
              label="Header discount (sum of lines)"
              disabled
              error={errorForField(errors, "header-discount")}
              value={String(invoice.discount)}
              hint="Edit line discounts; this total follows them."
              readOnly
            />
            <TextInput
              id="ref-usin"
              label="Ref USIN (debit/credit)"
              className="mono"
              disabled={locked}
              error={errorForField(errors, "ref-usin")}
              value={invoice.refUsin}
              onChange={(event) => onPatch({ refUsin: event.target.value })}
            />
          </div>
        </details>
        <div className="row" style={{ marginTop: 12 }}>
          <button
            className="btn ghost"
            type="button"
            disabled={locked || !invoice.buyerName.trim()}
            onClick={() => {
              void saveBuyer(owner.id, buyerDraftFromInvoice(invoice), invoice.buyerId).then((result) => {
                if (result.errors.length) {
                  onPush("bad", result.errors[0] ?? "Could not save buyer.");
                  return;
                }
                onPatch(applyBuyerToInvoice(result.buyer));
                onPush("good", `Saved buyer ${result.buyer.name}.`);
              });
            }}
          >
            Save buyer to this file
          </button>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn stamp" type="button" onClick={() => onSetStep(nextInvoiceStep(step))}>
            Continue to lines
          </button>
        </div>
      </Panel>
    </div>
  );
}

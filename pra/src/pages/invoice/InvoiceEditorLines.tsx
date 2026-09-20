import type { KeyboardEvent } from "react";
import { AmountInput } from "../../components/Field";
import { ItemPicker, PctPicker } from "../../components/ItemPicker";
import { Panel } from "../../components/Panel";
import { applyItemToLine, applyPctToLine } from "../../domain/catalog";
import { nextInvoiceStep, prevInvoiceStep, type InvoiceStep } from "../../domain/deskChrome";
import { errorForField } from "../../lib/fieldErrors";
import { pkr } from "../../lib/money";
import { recalcLine, totalsFromItems } from "../../lib/pra";
import type { CatalogItem, Invoice, InvoiceLine, PctCode } from "../../types";

type InvoiceEditorLinesProps = {
  invoice: Invoice;
  errors: string[];
  locked: boolean;
  step: InvoiceStep;
  catalogItems: CatalogItem[];
  pctRates: PctCode[];
  rateHint: string;
  blankLine: (index: number) => InvoiceLine;
  onPatch: (partial: Partial<Invoice>) => void;
  onPatchLine: (id: string, partial: Partial<InvoiceLine>) => void;
  onAddLine: () => void;
  onLineKeyDown: (event: KeyboardEvent<HTMLInputElement>, rowIndex: number, col: string) => void;
  onSetStep: (step: InvoiceStep) => void;
};

export function InvoiceEditorLines({
  invoice,
  errors,
  locked,
  step,
  catalogItems,
  pctRates,
  rateHint,
  blankLine,
  onPatch,
  onPatchLine,
  onAddLine,
  onLineKeyDown,
  onSetStep,
}: InvoiceEditorLinesProps) {
  return (
    <div className="editor-span no-print" id="invoice-lines">
      <Panel
        title="2 · Lines"
        actions={
          <button className="btn ghost" type="button" disabled={locked} onClick={onAddLine}>
            Add line
          </button>
        }
      >
        <div className="picker-row">
          <ItemPicker
            items={catalogItems}
            disabled={locked}
            onPick={(item) => {
              const next = applyItemToLine(blankLine(invoice.items.length + 1), item);
              const items = [...invoice.items, recalcLine(next)];
              onPatch({ items, ...totalsFromItems(items) });
            }}
          />
          <PctPicker
            rates={pctRates}
            disabled={locked}
            onPick={(rate) => {
              const next = applyPctToLine(blankLine(invoice.items.length + 1), rate);
              const items = [...invoice.items, recalcLine(next)];
              onPatch({ items, ...totalsFromItems(items) });
            }}
          />
        </div>
        <div className="table-wrap">
          <table className="line-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Qty</th>
                <th>PCT</th>
                <th>Rate %</th>
                <th>Sale value</th>
                <th>Discount</th>
                <th>Further tax</th>
                <th>Tax</th>
                <th>Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((line, rowIndex) => (
                <tr key={line.id}>
                  <td data-label="Code">
                    <input
                      className="mono"
                      disabled={locked}
                      aria-label={`Item code ${line.itemCode || "line"}`}
                      aria-invalid={errorForField(errors, `line-${rowIndex + 1}-itemCode`) ? true : undefined}
                      data-line-row={rowIndex}
                      data-line-col="itemCode"
                      value={line.itemCode}
                      onKeyDown={(event) => onLineKeyDown(event, rowIndex, "itemCode")}
                      onChange={(event) => onPatchLine(line.id, { itemCode: event.target.value })}
                    />
                  </td>
                  <td data-label="Name">
                    <input
                      disabled={locked}
                      aria-label={`Item name ${line.itemCode || "line"}`}
                      aria-invalid={errorForField(errors, `line-${rowIndex + 1}-itemName`) ? true : undefined}
                      data-line-row={rowIndex}
                      data-line-col="itemName"
                      value={line.itemName}
                      onKeyDown={(event) => onLineKeyDown(event, rowIndex, "itemName")}
                      onChange={(event) => onPatchLine(line.id, { itemName: event.target.value })}
                    />
                  </td>
                  <td data-label="Qty">
                    <AmountInput
                      disabled={locked}
                      aria-label={`Quantity ${line.itemCode || "line"}`}
                      error={errorForField(errors, `line-${rowIndex + 1}-quantity`)}
                      data-line-row={rowIndex}
                      data-line-col="quantity"
                      value={line.quantity}
                      onKeyDown={(event) => onLineKeyDown(event, rowIndex, "quantity")}
                      onValueChange={(quantity) => onPatchLine(line.id, { quantity })}
                    />
                  </td>
                  <td data-label="PCT code">
                    <input
                      className="mono"
                      disabled={locked}
                      aria-label={`PCT code ${line.itemCode || "line"}`}
                      aria-invalid={errorForField(errors, `line-${rowIndex + 1}-pctCode`) ? true : undefined}
                      data-line-row={rowIndex}
                      data-line-col="pctCode"
                      value={line.pctCode}
                      onKeyDown={(event) => onLineKeyDown(event, rowIndex, "pctCode")}
                      onChange={(event) => onPatchLine(line.id, { pctCode: event.target.value })}
                    />
                  </td>
                  <td data-label="Rate %">
                    <AmountInput
                      disabled={locked}
                      aria-label={`Tax rate ${line.itemCode || "line"}`}
                      error={errorForField(errors, `line-${rowIndex + 1}-taxRate`)}
                      data-line-row={rowIndex}
                      data-line-col="taxRate"
                      value={line.taxRate}
                      onKeyDown={(event) => onLineKeyDown(event, rowIndex, "taxRate")}
                      onValueChange={(taxRate) => onPatchLine(line.id, { taxRate })}
                    />
                  </td>
                  <td data-label="Sale value">
                    <AmountInput
                      disabled={locked}
                      aria-label={`Sale value ${line.itemCode || "line"}`}
                      error={errorForField(errors, `line-${rowIndex + 1}-saleValue`)}
                      data-line-row={rowIndex}
                      data-line-col="saleValue"
                      value={line.saleValue}
                      onKeyDown={(event) => onLineKeyDown(event, rowIndex, "saleValue")}
                      onValueChange={(saleValue) => onPatchLine(line.id, { saleValue })}
                    />
                  </td>
                  <td data-label="Discount">
                    <AmountInput
                      disabled={locked}
                      aria-label={`Line discount ${line.itemCode}`}
                      error={errorForField(errors, `line-${rowIndex + 1}-discount`)}
                      data-line-row={rowIndex}
                      data-line-col="discount"
                      value={line.discount}
                      onKeyDown={(event) => onLineKeyDown(event, rowIndex, "discount")}
                      onValueChange={(discount) => onPatchLine(line.id, { discount })}
                    />
                  </td>
                  <td data-label="Further tax">
                    <AmountInput
                      disabled={locked}
                      aria-label={`Further tax ${line.itemCode || "line"}`}
                      error={errorForField(errors, `line-${rowIndex + 1}-furtherTax`)}
                      data-line-row={rowIndex}
                      data-line-col="furtherTax"
                      value={line.furtherTax}
                      onKeyDown={(event) => onLineKeyDown(event, rowIndex, "furtherTax")}
                      onValueChange={(furtherTax) => onPatchLine(line.id, { furtherTax })}
                    />
                  </td>
                  <td className="mono" data-label="Tax">
                    {pkr(line.taxCharged)}
                  </td>
                  <td className="mono" data-label="Total">
                    {pkr(line.totalAmount)}
                  </td>
                  <td className="line-remove">
                    <button
                      className="btn ghost"
                      type="button"
                      disabled={locked}
                      onClick={() => {
                        const items = invoice.items.filter((item) => item.id !== line.id);
                        onPatch({ items, ...totalsFromItems(items) });
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {invoice.items.length === 0 ? (
                <tr>
                  <td colSpan={11} className="muted">
                    Add a line or pick an item / PCT. New lines use the catalog rate ({rateHint}).
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn ghost" type="button" onClick={() => onSetStep(prevInvoiceStep(step))}>
            Back
          </button>
          <button className="btn stamp" type="button" onClick={() => onSetStep(nextInvoiceStep(step))}>
            Continue to review
          </button>
        </div>
      </Panel>
    </div>
  );
}

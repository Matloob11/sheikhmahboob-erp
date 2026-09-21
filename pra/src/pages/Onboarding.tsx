import { useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { useNotice } from "../context/NoticeContext";

const POS_VALUES = [
  { id: "software", en: "POS Software Name", ur: "POS سافٹ ویئر کا نام", value: "Daftar" },
  { id: "type", en: "POS Type", ur: "POS کی قسم", value: "Cloud based" },
  {
    id: "inhouse",
    en: "In-house software development",
    ur: "ان ہاؤس سافٹ ویئر ڈیولپمنٹ",
    value: "No",
  },
  {
    id: "vendor",
    en: "POS Software Vendor",
    ur: "POS سافٹ ویئر وینڈر",
    value: "Sheikh Mahboob",
  },
  {
    id: "ip",
    en: "Pos Details → IP Address",
    ur: "Pos Details → IP ایڈریس",
    value: "187.53.143.235",
  },
] as const;

const EMAIL_TEMPLATE = `Subject: Production POS / IP whitelist request — Daftar

Dear PRA EIMS team,

Please approve production access for our POS registered through Daftar (Sheikh Mahboob).

Business PNTN: [YOUR PNTN]
POS ID: [YOUR POS ID]
POS Software Name: Daftar
POS Type: Cloud based
POS Software Vendor: Sheikh Mahboob
Server IP to whitelist: 187.53.143.235

We have completed Generate Test POS and a successful sandbox post from Daftar.

Thank you,
[YOUR NAME]
[YOUR PHONE]
`;

function CopyRow({ labelEn, labelUr, value }: { labelEn: string; labelUr: string; value: string }) {
  const { push } = useNotice();
  return (
    <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
      <div>
        <div>
          <strong>{labelEn}</strong>
        </div>
        <div className="muted" dir="rtl" lang="ur">
          {labelUr}
        </div>
        <code className="mono">{value}</code>
      </div>
      <button
        className="btn ghost"
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(
            () => push("good", "Copied."),
            () => push("bad", "Could not copy."),
          );
        }}
      >
        Copy
      </button>
    </div>
  );
}

export function OnboardingPage() {
  const { push } = useNotice();
  const [lang, setLang] = useState<"en" | "ur">("en");

  return (
    <div className="stack onboarding-print">
      <PageHeader
        title={lang === "en" ? "Connect your business to PRA" : "اپنے کاروبار کو PRA سے جوڑیں"}
        actions={
          <div className="row">
            <button
              className="btn ghost"
              type="button"
              aria-pressed={lang === "en"}
              onClick={() => setLang("en")}
            >
              English
            </button>
            <button
              className="btn ghost"
              type="button"
              aria-pressed={lang === "ur"}
              onClick={() => setLang("ur")}
            >
              اردو
            </button>
            <button className="btn stamp" type="button" onClick={() => window.print()}>
              {lang === "en" ? "Print" : "پرنٹ"}
            </button>
          </div>
        }
      />

      {lang === "en" ? (
        <Panel title="What this is">
          <p style={{ marginTop: 0 }}>
            Daftar is the POS software. Sheikh Mahboob runs the server. You use Daftar to issue your
            own invoices and post them to PRA. Follow the steps below on the PRA portal, then finish
            the go-live checklist in Daftar.
          </p>
        </Panel>
      ) : (
        <Panel title="یہ کیا ہے">
          <p style={{ marginTop: 0 }} dir="rtl" lang="ur">
            دفتر POS سافٹ ویئر ہے۔ سرور شیخ محبوب چلاتے ہیں۔ آپ دفتر سے اپنے انوائس بنا کر PRA کو
            بھیجتے ہیں۔ پہلے PRA پورٹل پر درج ذیل مراحل مکمل کریں، پھر دفتر میں go-live چیک لسٹ ختم
            کریں۔
          </p>
        </Panel>
      )}

      <Panel title={lang === "en" ? "1. Register the POS on PRA" : "۱۔ PRA پر POS رجسٹر کریں"}>
        <ol style={{ marginTop: 0 }} dir={lang === "ur" ? "rtl" : undefined} lang={lang === "ur" ? "ur" : undefined}>
          {lang === "en" ? (
            <>
              <li>
                Open{" "}
                <a href="https://reg.pra.punjab.gov.pk" target="_blank" rel="noreferrer">
                  reg.pra.punjab.gov.pk
                </a>
              </li>
              <li>Go to Registration → POS Client Registration</li>
              <li>Enter exactly the values below (use Copy on each line)</li>
              <li>On Pos Details, set the IP address to the server IP</li>
              <li>Save, then use Generate Test POS</li>
              <li>Copy the POS ID and token into Daftar (client file / go-live)</li>
            </>
          ) : (
            <>
              <li>
                کھولیں{" "}
                <a href="https://reg.pra.punjab.gov.pk" target="_blank" rel="noreferrer">
                  reg.pra.punjab.gov.pk
                </a>
              </li>
              <li>Registration → POS Client Registration</li>
              <li>نیچے دی گئی قیمتیں بالکل ویسے ہی درج کریں (Copy دبائیں)</li>
              <li>Pos Details میں IP ایڈریس سرور والا لگائیں</li>
              <li>محفوظ کریں، پھر Generate Test POS</li>
              <li>POS ID اور ٹوکن دفتر میں درج کریں</li>
            </>
          )}
        </ol>
        <div className="stack" style={{ gap: 12 }}>
          {POS_VALUES.map((row) => (
            <CopyRow key={row.id} labelEn={row.en} labelUr={row.ur} value={row.value} />
          ))}
        </div>
      </Panel>

      <Panel title={lang === "en" ? "2. Sandbox test in Daftar" : "۲۔ دفتر میں سینڈ باکس ٹیسٹ"}>
        {lang === "en" ? (
          <ol style={{ marginTop: 0 }}>
            <li>Open your client → Go-live checklist</li>
            <li>Confirm POS ID and token are not the demo sandbox token</li>
            <li>Post one sandbox invoice (through the server when you are ready for server mode)</li>
            <li>Only after a sandbox server post passed will server posting unlock</li>
          </ol>
        ) : (
          <ol style={{ marginTop: 0 }} dir="rtl" lang="ur">
            <li>کلائنٹ کھولیں → Go-live چیک لسٹ</li>
            <li>POS ID اور ٹوکن ڈیمو نہ ہوں</li>
            <li>ایک سینڈ باکس انوائس پوسٹ کریں</li>
            <li>سرور موڈ تب کھلے گا جب سرور سے سینڈ باکس پوسٹ کامیاب ہو</li>
          </ol>
        )}
      </Panel>

      <Panel title={lang === "en" ? "3. Ask PRA for production" : "۳۔ PRA سے پروڈکشن کی درخواست"}>
        {lang === "en" ? (
          <p style={{ marginTop: 0 }}>
            Email <strong>eims@pra.punjab.gov.pk</strong>. Fill in your PNTN and POS ID in the
            template, then Copy and paste into your mail app.
          </p>
        ) : (
          <p style={{ marginTop: 0 }} dir="rtl" lang="ur">
            ای میل بھیجیں <strong>eims@pra.punjab.gov.pk</strong>۔ سانچے میں اپنا PNTN اور POS ID
            بھریں، Copy کر کے میل میں چسپاں کریں۔
          </p>
        )}
        <pre
          className="mono"
          style={{ whiteSpace: "pre-wrap", fontSize: 13, padding: 12, overflow: "auto" }}
        >
          {EMAIL_TEMPLATE}
        </pre>
        <button
          className="btn stamp"
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(EMAIL_TEMPLATE).then(
              () => push("good", "Email template copied."),
              () => push("bad", "Could not copy."),
            );
          }}
        >
          {lang === "en" ? "Copy email template" : "ای میل سانچہ کاپی کریں"}
        </button>
      </Panel>

      <p className="muted print-only-hide">
        {lang === "en"
          ? "Server posting stays off until PRA whitelists 187.53.143.235 and your POS is registered."
          : "جب تک PRA آئی پی 187.53.143.235 وائٹ لسٹ نہ کرے اور POS رجسٹر نہ ہو، سرور پوسٹنگ بند رہتی ہے۔"}
      </p>
    </div>
  );
}

import { useState } from "react";
import { TextInput } from "../../components/Field";
import { Panel } from "../../components/Panel";
import { TokenField } from "../../components/TokenField";
import { useDesk } from "../../context/DeskContext";
import { useNotice } from "../../context/NoticeContext";
import {
  clearPracticePin,
  hasPracticePin,
  lockPractice,
  setPracticePin,
  verifyPracticePin,
} from "../../domain/settings";
import { readIdleMinutes, writeIdleMinutes } from "../../lib/idleLock";

export function SecuritySection() {
  const { settings } = useDesk();
  const { push } = useNotice();
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [idleMinutes, setIdleMinutes] = useState(() => String(readIdleMinutes()));
  const locked = hasPracticePin(settings);

  async function savePin() {
    if (pin !== pinConfirm) {
      push("bad", "PIN and confirmation do not match.");
      return;
    }
    if (locked && settings) {
      const ok = await verifyPracticePin(currentPin, settings);
      if (!ok) {
        push("bad", "Current PIN does not match.");
        setCurrentPin("");
        return;
      }
    }
    const errors = await setPracticePin(pin);
    if (errors.length) {
      push("bad", errors[0] ?? "PIN not saved.");
      return;
    }
    setPin("");
    setPinConfirm("");
    setCurrentPin("");
    push("good", "Practice PIN saved.");
  }

  async function removePin() {
    if (!settings) return;
    const ok = await verifyPracticePin(currentPin, settings);
    if (!ok) {
      push("bad", "Current PIN does not match.");
      setCurrentPin("");
      return;
    }
    await clearPracticePin();
    setCurrentPin("");
    push("info", "Practice PIN removed.");
  }

  return (
    <Panel title="Security">
      <div id="security" className="stack">
        <p className="muted" style={{ margin: 0 }}>
          A PIN on this browser hides the desk until it is entered. Tokens stay behind Show/Hide and never
          appear in activity text.
        </p>
        {locked ? (
          <TokenField
            label="Current PIN"
            value={currentPin}
            onChange={setCurrentPin}
            autoComplete="current-password"
          />
        ) : null}
        <TokenField
          label={locked ? "New PIN" : "PIN"}
          value={pin}
          onChange={setPin}
          autoComplete="new-password"
          hint="At least 4 characters. Stored as a hash on this computer."
        />
        <TokenField
          label="Confirm PIN"
          value={pinConfirm}
          onChange={setPinConfirm}
          autoComplete="new-password"
        />
        <TextInput
          label="Lock after (minutes)"
          type="number"
          min={0}
          inputMode="numeric"
          value={idleMinutes}
          hint="0 turns idle lock off. Default 15. Stored on this browser, not in the backup."
          onChange={(event) => {
            setIdleMinutes(event.target.value);
            const next = Number(event.target.value);
            if (Number.isFinite(next) && next >= 0) writeIdleMinutes(next);
          }}
        />
        <div className="row">
          <button className="btn stamp" type="button" onClick={() => void savePin()}>
            {locked ? "Change PIN" : "Set PIN"}
          </button>
          {locked ? (
            <>
              <button className="btn ghost" type="button" onClick={() => lockPractice()}>
                Lock desk
              </button>
              <button className="btn ghost" type="button" onClick={() => void removePin()}>
                Remove PIN
              </button>
            </>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

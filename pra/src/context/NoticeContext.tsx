import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { newId } from "../lib/ids";

export type NoticeTone = "good" | "bad" | "info";

export interface Notice {
  id: string;
  tone: NoticeTone;
  text: string;
}

interface NoticeValue {
  notices: Notice[];
  push: (tone: NoticeTone, text: string) => void;
  dismiss: (id: string) => void;
}

const NoticeContext = createContext<NoticeValue | null>(null);

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);

  const dismiss = useCallback((id: string) => {
    setNotices((current) => current.filter((row) => row.id !== id));
  }, []);

  const push = useCallback((tone: NoticeTone, text: string) => {
    const id = newId("ntc");
    setNotices((current) => [...current.slice(-3), { id, tone, text }]);
  }, []);

  const value = useMemo(() => ({ notices, push, dismiss }), [notices, push, dismiss]);
  return <NoticeContext.Provider value={value}>{children}</NoticeContext.Provider>;
}

export function useNotice(): NoticeValue {
  const value = useContext(NoticeContext);
  if (!value) throw new Error("useNotice must be used inside NoticeProvider");
  return value;
}

function NoticeToast({ notice, dismiss }: { notice: Notice; dismiss: (id: string) => void }) {
  const left = useRef(5000);
  const started = useRef(0);
  const timer = useRef(0);

  const arm = useCallback(() => {
    window.clearTimeout(timer.current);
    started.current = Date.now();
    timer.current = window.setTimeout(() => dismiss(notice.id), Math.max(left.current, 0));
  }, [dismiss, notice.id]);

  useEffect(() => {
    arm();
    return () => window.clearTimeout(timer.current);
  }, [arm]);

  function pause() {
    window.clearTimeout(timer.current);
    left.current -= Date.now() - started.current;
  }

  return (
    <button
      type="button"
      className={`alert ${notice.tone === "bad" ? "bad" : notice.tone === "good" ? "good" : "info"}`}
      onClick={() => dismiss(notice.id)}
      onMouseEnter={pause}
      onMouseLeave={arm}
      onFocus={pause}
      onBlur={arm}
    >
      {notice.text}
    </button>
  );
}

export function NoticeStack() {
  const { notices, dismiss } = useNotice();
  if (!notices.length) return null;
  return (
    <div className="notice-stack" role="status">
      {notices.map((notice) => (
        <NoticeToast key={notice.id} notice={notice} dismiss={dismiss} />
      ))}
    </div>
  );
}

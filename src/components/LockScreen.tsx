/** 应用锁定遮罩：仅密码校验（SHA-256），不存储明文 */

import { LockKeyhole } from "lucide-react";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSettings } from "@/store/settings";
import { useUi } from "@/store/ui";

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function LockScreen() {
  const locked = useUi((s) => s.locked);
  const setLocked = useUi((s) => s.setLocked);
  const lockHash = useSettings((s) => s.lockHash);
  const [pwd, setPwd] = useState("");
  const [error, setError] = useState(false);

  const unlock = async () => {
    const hash = await sha256(pwd);
    if (hash === lockHash) {
      setLocked(false);
      setPwd("");
      setError(false);
    } else {
      setError(true);
    }
  };

  return (
    <AnimatePresence>
      {locked && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[99] sheet flex items-center justify-center"
        >
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-3">
            <LockKeyhole size={30} className="text-primary" />
            <div className="text-sm font-semibold text-text">应用已锁定</div>
            <input
              type="password"
              autoFocus
              value={pwd}
              onChange={(e) => { setPwd(e.target.value); setError(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") void unlock(); }}
              placeholder="输入主密码"
              className="input w-[200px] text-center"
            />
            {error && <div className="text-2xs text-danger">密码错误</div>}
            <button className="btn-primary h-8" onClick={() => void unlock()}>解锁</button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
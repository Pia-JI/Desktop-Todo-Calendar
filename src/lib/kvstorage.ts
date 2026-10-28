/**
 * Zustand 持久化中间件的存储后端：写入 SQLite 的 settings 表（而非 localStorage）。
 * 采用「按字段拆行」策略：每个顶层 key 单独一行，
 * 这样 Rust 侧后台任务（晨报 / 快照 / 同步）可以直接按 key 读取设置，无需解析整块 JSON。
 *
 * 两个必须的约束（都踩过坑）：
 * 1) **水合前不落盘**：persist 是异步水合的，读库还没回来时组件已经在用默认值渲染，
 *    此时任何一次 set 都会把「默认值整块」写回存储，于是设置每次重启都跳回默认。
 *    这里用一条串行队列保证「首次读取一定先于任何写入」。
 * 2) **串行化写入**：多个字段的写是一条条 SQL，交错执行会出现半新半旧的状态。
 */

import type { StateStorage } from "zustand/middleware";
import { getRepo } from "./db";

const KEYS_META = "__keys";

export function createKvStorage(ns: string): StateStorage {
  let hydrated: Promise<void> | null = null;
  let chain: Promise<unknown> = Promise.resolve();

  /** 所有读写排队执行，保证顺序（读在前、写在后，且写之间不交错） */
  const enqueue = <T,>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task, task);
    chain = run.catch(() => undefined);
    return run;
  };

  return {
    getItem: (name: string) => {
      const read = enqueue(async () => {
        const repo = await getRepo();
        const all = await repo.kvGetAll(ns);
        const keysRaw = all[KEYS_META];
        if (!keysRaw) return null;
        let keys: string[] = [];
        try {
          keys = JSON.parse(keysRaw) as string[];
        } catch {
          return null;
        }
        const obj: Record<string, unknown> = {};
        for (const k of keys) {
          if (k in all) {
            try {
              obj[k] = JSON.parse(all[k]);
            } catch {
              obj[k] = all[k];
            }
          }
        }
        void name;
        return JSON.stringify(obj);
      });
      hydrated = read.then(() => undefined, () => undefined);
      return read;
    },

    setItem: (name: string, value: string) =>
      enqueue(async () => {
        if (hydrated) await hydrated;
        const repo = await getRepo();
        const prev = await repo.kvGetAll(ns);
        let prevKeys: string[] = [];
        try {
          prevKeys = prev[KEYS_META] ? (JSON.parse(prev[KEYS_META]) as string[]) : [];
        } catch {
          prevKeys = [];
        }

        let next: Record<string, unknown> = {};
        try {
          next = JSON.parse(value) as Record<string, unknown>;
        } catch {
          return;
        }
        const nextKeys = Object.keys(next);

        for (const k of nextKeys) {
          await repo.kvSet(ns, k, JSON.stringify(next[k]));
        }
        for (const k of prevKeys) {
          if (!(k in next)) await repo.kvDel(ns, k);
        }
        await repo.kvSet(ns, KEYS_META, JSON.stringify(nextKeys));
        void name;
      }),

    removeItem: (name: string) =>
      enqueue(async () => {
        const repo = await getRepo();
        const all = await repo.kvGetAll(ns);
        for (const k of Object.keys(all)) await repo.kvDel(ns, k);
        void name;
      }),
  };
}

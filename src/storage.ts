import type { Order, PersistState, WaxBatch } from "./types";
import { WAX_TYPES } from "./types";

const STORAGE_KEY = "wax-workbench-v1";

export function waxNeedGrams(lengthCm: number): number {
  return Math.max(0, Math.round(lengthCm));
}

function batch(
  id: string,
  waxType: (typeof WAX_TYPES)[number],
  lotNo: string,
  grams: number,
  createdAt: number
): WaxBatch {
  return { id, waxType, lotNo, grams, totalIn: grams, createdAt };
}

function seed(): PersistState {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const batches: WaxBatch[] = [
    batch("B-01", "低温蜡", "LT-20260112", 400, now - 10 * day),
    batch("B-02", "低温蜡", "LT-20260220", 260, now - 6 * day),
    batch("B-03", "全温蜡", "AL-20260301", 500, now - 4 * day),
    batch("B-04", "高温蜡", "HT-20260310", 220, now - 2 * day),
    batch("B-05", "竞速蜡", "RC-20260318", 150, now - day),
  ];

  const mk = (
    seq: number,
    o: Omit<
      Order,
      "id" | "shortage" | "usages" | "timeline" | "reviewDirty" | "createdAt" | "deliveredAt" | "status"
    > &
      Partial<Pick<Order, "status" | "createdAt">>
  ): Order => {
    const createdAt = o.createdAt ?? now - day;
    return {
      ...o,
      createdAt,
      id: `WO-${String(seq).padStart(3, "0")}`,
      status: o.status ?? "待选蜡",
      shortage: null,
      usages: [],
      timeline: [{ at: createdAt, text: "登记工单" }],
      reviewDirty: false,
      deliveredAt: null,
    };
  };

  const orders: Order[] = [
    mk(101, {
      customer: "刘畅",
      contact: "138****2041",
      brand: "Burton Custom 156",
      boardType: "全地域板",
      lengthCm: 156,
      edgeSide: 88,
      edgeBase: 1,
      baseDamage: "板底中段 12cm 浅划痕",
      repairSpots: "中段 P-Tex 填补",
      preference: "偏好低温蜡，刃角保持 88°/1°",
      createdAt: now - 2 * day,
    }),
    mk(102, {
      customer: "周岩",
      contact: "139****7782",
      brand: "F2 Race 165",
      boardType: "竞速板",
      lengthCm: 165,
      edgeSide: 87,
      edgeBase: 0.5,
      baseDamage: "板尾小磕痕",
      repairSpots: "",
      preference: "竞速蜡，咬雪强",
      createdAt: now - 2 * day,
    }),
    mk(103, {
      customer: "陈雪",
      contact: "137****5530",
      brand: "Jones Hovercraft 158",
      boardType: "粉雪板",
      lengthCm: 158,
      edgeSide: 89,
      edgeBase: 1,
      baseDamage: "无明显损伤",
      repairSpots: "",
      preference: "弱咬雪，全温蜡",
      createdAt: now - day,
    }),
  ];

  return { version: 1, batches, orders, orderSeq: 103 };
}

export function loadState(): PersistState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistState;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.orders) && Array.isArray(parsed.batches)) {
        return parsed;
      }
    }
  } catch {
    // 本地数据损坏时回退到示例数据
  }
  const initial = seed();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  } catch {
    // 隐私模式等场景下仅内存可用
  }
  return initial;
}

export function saveState(state: PersistState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 忽略写入失败，页面内状态仍然可用
  }
}

export function clearState(): PersistState {
  const fresh = seed();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
  } catch {
    // ignore
  }
  return fresh;
}

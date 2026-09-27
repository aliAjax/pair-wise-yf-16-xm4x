export const WAX_TYPES = ["低温蜡", "全温蜡", "高温蜡", "竞速蜡"] as const;
export type WaxType = (typeof WAX_TYPES)[number];

export const BOARD_TYPES = ["全地域板", "公园板", "竞速板", "粉雪板"] as const;
export type BoardType = (typeof BOARD_TYPES)[number];

export type OrderStatus = "待选蜡" | "待备料" | "待复核" | "已交付";

export const ORDER_STATUSES: OrderStatus[] = ["待选蜡", "待备料", "待复核", "已交付"];

/** 每厘米板长耗蜡 1 g，按板长整板扣库存 */
export const WAX_GRAMS_PER_CM = 1;

export interface WaxBatch {
  id: string;
  waxType: string;
  /** 批号 */
  lotNo: string;
  /** 当前余量（克） */
  grams: number;
  /** 累计入库量（克），用于统计已耗量 */
  totalIn: number;
  createdAt: number;
}

export interface WaxUsage {
  batchId: string;
  waxType: string;
  lotNo: string;
  /** 本次扣减克数 = 板长（cm）× WAX_GRAMS_PER_CM，已扣不退还 */
  grams: number;
  boardLengthCm: number;
  at: number;
}

export interface Shortage {
  batchId: string;
  waxType: string;
  lotNo: string;
  /** 本板需蜡 */
  need: number;
  /** 当时余量 */
  have: number;
  /** 缺量 */
  missing: number;
  at: number;
}

export interface TimelineEntry {
  at: number;
  text: string;
}

export interface Order {
  id: string;
  customer: string;
  contact: string;
  brand: string;
  boardType: string;
  lengthCm: number;
  edgeSide: number;
  edgeBase: number;
  baseDamage: string;
  repairSpots: string;
  preference: string;
  status: OrderStatus;
  /** 余量不足时挂起的缺料信息，备齐后重新选蜡成功即清除 */
  shortage: Shortage | null;
  /** 每次打蜡一条，已扣蜡永久保留，不退还 */
  usages: WaxUsage[];
  timeline: TimelineEntry[];
  /** 打蜡后又改过刃角/损伤，需要复核重新确认 */
  reviewDirty: boolean;
  createdAt: number;
  deliveredAt: number | null;
}

export interface PersistState {
  version: 1;
  batches: WaxBatch[];
  orders: Order[];
  orderSeq: number;
}

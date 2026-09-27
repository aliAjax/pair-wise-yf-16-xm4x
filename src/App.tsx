import { useEffect, useState } from "react";
import "./styles.css";

/* ================= 数据模型 ================= */

type Status = "待备料" | "打蜡中" | "已打蜡" | "待复核" | "已交付";

interface WaxBatch {
  id: string;
  waxType: string;
  batchNo: string;
  totalGrams: number;
  remainingGrams: number;
}

interface WaxUsage {
  id: string;
  waxType: string;
  batchNo: string;
  grams: number;
  at: string;
}

interface WorkOrder {
  id: string;
  customer: string;
  boardType: string;
  lengthCm: number;
  edgeAngle: string;
  preference: string;
  damage: string;
  status: Status;
  usages: WaxUsage[];
  shortageGrams: number | null;
  shortageNote: string | null;
  pendingNote: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

interface DeliveryRecord {
  orderId: string;
  deliveredAt: string;
  boardType: string;
  lengthCm: number;
  edgeAngle: string;
  usages: WaxUsage[];
  totalGrams: number;
}

interface BenchState {
  batches: WaxBatch[];
  orders: WorkOrder[];
  history: Record<string, DeliveryRecord[]>;
}

/* ================= 常量与工具 ================= */

// 每种蜡型按板长扣库存的费率（克 / 厘米）
const WAX_RATE: Record<string, number> = {
  低温蜡: 0.32,
  全能蜡: 0.28,
  高温蜡: 0.3,
  氟素竞赛蜡: 0.22,
};
const WAX_TYPES = Object.keys(WAX_RATE);
const BOARD_TYPES = ["全能板", "公园板", "竞速板", "粉雪板", "野雪板"];
const STATUSES: Status[] = ["待备料", "打蜡中", "已打蜡", "待复核", "已交付"];
const STATUS_CLASS: Record<Status, string> = {
  待备料: "st-wait",
  打蜡中: "st-run",
  已打蜡: "st-waxed",
  待复核: "st-review",
  已交付: "st-done",
};
const LOW_STOCK_GRAMS = 80;
const STORAGE_KEY = "wax-bench-state-v1";

const requiredGrams = (lengthCm: number, waxType: string) =>
  Math.ceil(lengthCm * (WAX_RATE[waxType] ?? 0.3));

const now = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

let seq = 0;
const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${(seq++).toString(36).padStart(2, "0")}`;

/* ================= 种子数据与持久化 ================= */

function seedState(): BenchState {
  const batches: WaxBatch[] = [
    { id: "B-LT-A", waxType: "低温蜡", batchNo: "LT-2609-A", totalGrams: 500, remainingGrams: 400 },
    { id: "B-LT-B", waxType: "低温蜡", batchNo: "LT-2609-B", totalGrams: 120, remainingGrams: 70 },
    { id: "B-UN-C", waxType: "全能蜡", batchNo: "UN-2610-C", totalGrams: 800, remainingGrams: 753 },
    { id: "B-HT-A", waxType: "高温蜡", batchNo: "HT-2608-A", totalGrams: 400, remainingGrams: 0 },
    { id: "B-FL-A", waxType: "氟素竞赛蜡", batchNo: "FL-2611-A", totalGrams: 300, remainingGrams: 210 },
  ];
  const orders: WorkOrder[] = [
    {
      id: "WO-2601", customer: "王磊", boardType: "竞速板", lengthCm: 165,
      edgeAngle: "侧刃88° / 底刃0.7°", preference: "弱咬雪、出弯快",
      damage: "板底划痕约12cm，已补P-Tex", status: "已打蜡",
      usages: [{ id: "U-1", waxType: "全能蜡", batchNo: "UN-2610-C", grams: 47, at: "2026-09-26 15:40" }],
      shortageGrams: null, shortageNote: null, pendingNote: null,
      createdAt: "2026-09-26 14:05", deliveredAt: null,
    },
    {
      id: "WO-2602", customer: "陈雪", boardType: "粉雪板", lengthCm: 158,
      edgeAngle: "侧刃89° / 底刃1°", preference: "浮力优先、蜡要耐高温",
      damage: "板头磕痕两处", status: "待备料",
      usages: [], shortageGrams: 48,
      shortageNote: "高温蜡 · 批号 HT-2608-A 余量 0g，需 48g",
      pendingNote: null, createdAt: "2026-09-27 09:12", deliveredAt: null,
    },
    {
      id: "WO-2603", customer: "王磊", boardType: "公园板", lengthCm: 154,
      edgeAngle: "侧刃88° / 底刃1°", preference: "呲杆要顺滑",
      damage: "板尾轻微分层", status: "待复核",
      usages: [{ id: "U-2", waxType: "低温蜡", batchNo: "LT-2609-A", grams: 50, at: "2026-09-27 10:05" }],
      shortageGrams: null, shortageNote: null,
      pendingNote: "改刃角：侧刃89° / 底刃1° → 侧刃88° / 底刃1°",
      createdAt: "2026-09-27 09:48", deliveredAt: null,
    },
    {
      id: "WO-2604", customer: "李航", boardType: "全能板", lengthCm: 156,
      edgeAngle: "侧刃88° / 底刃1°", preference: "雪道滑全天",
      damage: "无", status: "已交付",
      usages: [
        { id: "U-3", waxType: "低温蜡", batchNo: "LT-2609-B", grams: 50, at: "2026-09-25 11:20" },
        { id: "U-4", waxType: "低温蜡", batchNo: "LT-2609-A", grams: 50, at: "2026-09-25 16:42" },
      ],
      shortageGrams: null, shortageNote: null, pendingNote: null,
      createdAt: "2026-09-25 10:58", deliveredAt: "2026-09-25 18:03",
    },
  ];
  const history: Record<string, DeliveryRecord[]> = {
    李航: [{
      orderId: "WO-2604", deliveredAt: "2026-09-25 18:03",
      boardType: "全能板", lengthCm: 156, edgeAngle: "侧刃88° / 底刃1°",
      usages: orders[3].usages, totalGrams: 100,
    }],
  };
  return { batches, orders, history };
}

function loadState(): BenchState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as BenchState;
      if (parsed && Array.isArray(parsed.batches) && Array.isArray(parsed.orders) && parsed.history) {
        return parsed;
      }
    }
  } catch {
    /* 本地数据损坏时回退到种子数据 */
  }
  return seedState();
}

/* ================= 工单卡片 ================= */

interface OrderCardProps {
  order: WorkOrder;
  batches: WaxBatch[];
  onStart: (orderId: string, waxType: string, batchId: string) => void;
  onFinish: (orderId: string) => void;
  onEdge: (orderId: string, angle: string) => void;
  onDamage: (orderId: string, note: string) => void;
  onReviewPass: (orderId: string) => void;
  onDeliver: (orderId: string) => void;
  onDelete: (orderId: string) => void;
}

function OrderCard({ order, batches, onStart, onFinish, onEdge, onDamage, onReviewPass, onDeliver, onDelete }: OrderCardProps) {
  const usedBatchNos = order.usages.map((u) => u.batchNo);
  const totalUsed = order.usages.reduce((s, u) => s + u.grams, 0);

  const [waxType, setWaxType] = useState(WAX_TYPES[0]);
  const [batchId, setBatchId] = useState("");
  const [edgeOpen, setEdgeOpen] = useState(false);
  const [edgeVal, setEdgeVal] = useState(order.edgeAngle);
  const [damageOpen, setDamageOpen] = useState(false);
  const [damageVal, setDamageVal] = useState("");
  const [deliverArmed, setDeliverArmed] = useState(false);

  // 再次打蜡必须换批号：凡已用过的批号都不可再选
  const startBatches = batches.filter(
    (b) => b.waxType === waxType && !usedBatchNos.includes(b.batchNo)
  );
  const need = requiredGrams(order.lengthCm, waxType);
  const selectedBatch = batches.find((b) => b.id === batchId);

  return (
    <article className="order-card">
      <header className="order-head">
        <div className="order-title">
          <strong>{order.id}</strong>
          <span className={`badge ${STATUS_CLASS[order.status]}`}>{order.status}</span>
        </div>
        <span className="order-sub">
          {order.customer} · {order.boardType} · {order.lengthCm}cm · 登记 {order.createdAt}
        </span>
      </header>

      <div className="order-meta">
        <span>刃角 <b>{order.edgeAngle}</b></span>
        <span>偏好 {order.preference || "—"}</span>
        <span>损伤 {order.damage || "无"}</span>
      </div>

      {order.usages.length > 0 && (
        <ul className="usage-list">
          {order.usages.map((u) => (
            <li key={u.id}>{u.at} · {u.waxType} · 批号 {u.batchNo} · 扣 {u.grams}g</li>
          ))}
        </ul>
      )}

      {order.status === "待备料" && order.shortageGrams != null && (
        <p className="shortage">
          备料不足，停在待备料：{order.shortageNote}，缺量 {order.shortageGrams}g。补货或更换批号后重新开工。
        </p>
      )}

      {order.status === "待复核" && order.pendingNote && (
        <p className="review-note">
          待复核：{order.pendingNote} · 已扣蜡 {totalUsed}g 不退回库存
        </p>
      )}

      {(order.status === "待备料" || order.status === "待复核") && (
        <div className="start-box">
          <p className="start-title">
            {order.usages.length === 0 ? "开工前选择蜡型与批号" : "再次打蜡（须更换批号，已扣蜡不退回）"}
          </p>
          <div className="start-grid">
            <select value={waxType} onChange={(e) => { setWaxType(e.target.value); setBatchId(""); }}>
              {WAX_TYPES.map((t) => (
                <option key={t} value={t}>{t}（{WAX_RATE[t]}g/cm）</option>
              ))}
            </select>
            <select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
              <option value="">选择批号</option>
              {startBatches.map((b) => (
                <option key={b.id} value={b.id} disabled={b.remainingGrams <= 0}>
                  {b.batchNo}（余量 {b.remainingGrams}g）
                </option>
              ))}
            </select>
            <button
              className="primary"
              disabled={!batchId}
              onClick={() => { onStart(order.id, waxType, batchId); setBatchId(""); }}
            >
              {order.usages.length === 0 ? "开工打蜡" : "再次打蜡"}（扣 {need}g）
            </button>
          </div>
          <p className="hint">
            预计用量 {need}g = 板长 {order.lengthCm}cm × {WAX_RATE[waxType]}g/cm
            {selectedBatch && selectedBatch.remainingGrams < need
              ? ` · 所选批次余量不足，将缺 ${need - selectedBatch.remainingGrams}g`
              : ""}
          </p>
          {startBatches.length === 0 && (
            <p className="hint warn">该蜡型暂无可用批号{usedBatchNos.length > 0 ? "（已用批号不可重复）" : ""}，请先在库存中入库。</p>
          )}
          {order.usages.length > 0 && startBatches.length > 0 && (
            <p className="hint">已用批号：{usedBatchNos.join("、")}，不可重复选用。</p>
          )}
          {order.status === "待复核" && (
            <button className="ghost" onClick={() => onReviewPass(order.id)}>复核通过，回到已打蜡</button>
          )}
        </div>
      )}

      {order.status === "打蜡中" && (
        <div className="actions">
          <button className="primary" onClick={() => onFinish(order.id)}>完成打蜡</button>
        </div>
      )}

      {order.status === "已打蜡" && (
        <>
          <div className="actions">
            {!deliverArmed ? (
              <button className="primary" onClick={() => setDeliverArmed(true)}>交付客户</button>
            ) : (
              <>
                <button className="primary" onClick={() => { onDeliver(order.id); setDeliverArmed(false); }}>
                  确认交付（写入客户历史）
                </button>
                <button onClick={() => setDeliverArmed(false)}>取消</button>
              </>
            )}
            <button onClick={() => { setEdgeOpen((v) => !v); setEdgeVal(order.edgeAngle); }}>改刃角</button>
            <button onClick={() => setDamageOpen((v) => !v)}>补记损伤</button>
          </div>
          {edgeOpen && (
            <div className="inline-form">
              <input value={edgeVal} onChange={(e) => setEdgeVal(e.target.value)} placeholder="新刃角，如 侧刃88° / 底刃1°" />
              <button
                className="primary"
                disabled={!edgeVal.trim()}
                onClick={() => { onEdge(order.id, edgeVal.trim()); setEdgeOpen(false); }}
              >
                确认改刃（退回待复核）
              </button>
            </div>
          )}
          {damageOpen && (
            <div className="inline-form">
              <input value={damageVal} onChange={(e) => setDamageVal(e.target.value)} placeholder="补充损伤描述，如 板底新划痕5cm" />
              <button
                className="primary"
                disabled={!damageVal.trim()}
                onClick={() => { onDamage(order.id, damageVal.trim()); setDamageVal(""); setDamageOpen(false); }}
              >
                确认补记（退回待复核）
              </button>
            </div>
          )}
        </>
      )}

      {order.status === "已交付" && (
        <p className="done-line">已于 {order.deliveredAt} 交付，本次用量已写入客户历史（共 {totalUsed}g）。</p>
      )}

      {order.status === "待备料" && order.usages.length === 0 && (
        <button className="link-danger" onClick={() => onDelete(order.id)}>删除工单</button>
      )}
    </article>
  );
}

/* ================= 登记新工单 ================= */

function NewOrderForm({ onAdd }: {
  onAdd: (draft: { customer: string; boardType: string; lengthCm: number; edgeAngle: string; preference: string; damage: string }) => void;
}) {
  const [customer, setCustomer] = useState("");
  const [boardType, setBoardType] = useState(BOARD_TYPES[0]);
  const [lengthCm, setLengthCm] = useState("");
  const [edgeAngle, setEdgeAngle] = useState("侧刃88° / 底刃1°");
  const [preference, setPreference] = useState("");
  const [damage, setDamage] = useState("");

  const len = parseInt(lengthCm, 10);
  const valid = customer.trim().length > 0 && Number.isFinite(len) && len > 0;

  const submit = () => {
    if (!valid) return;
    onAdd({
      customer: customer.trim(),
      boardType,
      lengthCm: len,
      edgeAngle: edgeAngle.trim() || "侧刃88° / 底刃1°",
      preference: preference.trim(),
      damage: damage.trim() || "无",
    });
    setCustomer("");
    setLengthCm("");
    setPreference("");
    setDamage("");
  };

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>登记</p>
          <h2>新工单</h2>
        </div>
      </div>
      <div className="form-grid">
        <label>
          <span>客户姓名 *</span>
          <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="如 王磊" />
        </label>
        <label>
          <span>板型</span>
          <select value={boardType} onChange={(e) => setBoardType(e.target.value)}>
            {BOARD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>
          <span>板长（cm）*</span>
          <input value={lengthCm} onChange={(e) => setLengthCm(e.target.value)} placeholder="如 156" inputMode="numeric" />
        </label>
        <label>
          <span>刃角</span>
          <input value={edgeAngle} onChange={(e) => setEdgeAngle(e.target.value)} />
        </label>
        <label>
          <span>客户偏好</span>
          <input value={preference} onChange={(e) => setPreference(e.target.value)} placeholder="如 弱咬雪、出弯快" />
        </label>
        <label>
          <span>底板损伤</span>
          <input value={damage} onChange={(e) => setDamage(e.target.value)} placeholder="如 板底划痕12cm" />
        </label>
      </div>
      <button className="primary block" disabled={!valid} onClick={submit}>登记工单（进入待备料）</button>
    </section>
  );
}

/* ================= 蜡材库存 ================= */

function BatchRow({ batch, onRestock }: { batch: WaxBatch; onRestock: (batchId: string, grams: number) => void }) {
  const [grams, setGrams] = useState("");
  const add = parseInt(grams, 10);
  const pct = batch.totalGrams > 0 ? Math.round((batch.remainingGrams / batch.totalGrams) * 100) : 0;
  const low = batch.remainingGrams < LOW_STOCK_GRAMS;

  return (
    <div className="batch-row">
      <div className="batch-head">
        <div>
          <b>{batch.waxType}</b>
          <span className="batch-no">批号 {batch.batchNo}</span>
        </div>
        <div className="batch-amount">
          <strong className={low ? "low" : ""}>{batch.remainingGrams}g</strong>
          <span>/ {batch.totalGrams}g</span>
        </div>
      </div>
      <div className={`progress${low ? " low" : ""}`}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="batch-foot">
        {batch.remainingGrams <= 0 ? (
          <em className="empty-tag">已用完</em>
        ) : low ? (
          <em className="low-tag">余量偏低</em>
        ) : (
          <span className="pct">{pct}%</span>
        )}
        <div className="restock">
          <input value={grams} onChange={(e) => setGrams(e.target.value)} placeholder="入库克数" inputMode="numeric" />
          <button
            disabled={!Number.isFinite(add) || add <= 0}
            onClick={() => { onRestock(batch.id, add); setGrams(""); }}
          >
            入库
          </button>
        </div>
      </div>
    </div>
  );
}

function BatchPanel({ batches, onAdd, onRestock }: {
  batches: WaxBatch[];
  onAdd: (waxType: string, batchNo: string, grams: number) => string | null;
  onRestock: (batchId: string, grams: number) => void;
}) {
  const [waxType, setWaxType] = useState(WAX_TYPES[0]);
  const [batchNo, setBatchNo] = useState("");
  const [grams, setGrams] = useState("");
  const [error, setError] = useState("");

  const g = parseInt(grams, 10);
  const valid = batchNo.trim().length > 0 && Number.isFinite(g) && g > 0;

  const submit = () => {
    if (!valid) return;
    const err = onAdd(waxType, batchNo.trim(), g);
    if (err) {
      setError(err);
    } else {
      setError("");
      setBatchNo("");
      setGrams("");
    }
  };

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>共享库存</p>
          <h2>蜡材批次</h2>
        </div>
      </div>
      <div className="batch-list">
        {batches.map((b) => <BatchRow key={b.id} batch={b} onRestock={onRestock} />)}
      </div>
      <div className="add-batch">
        <p className="start-title">新增批次</p>
        <div className="start-grid three">
          <select value={waxType} onChange={(e) => setWaxType(e.target.value)}>
            {WAX_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} placeholder="批号，如 LT-2610-A" />
          <input value={grams} onChange={(e) => setGrams(e.target.value)} placeholder="克数" inputMode="numeric" />
        </div>
        {error && <p className="hint warn">{error}</p>}
        <button className="primary block" disabled={!valid} onClick={submit}>添加批次</button>
      </div>
    </section>
  );
}

/* ================= 客户历史 ================= */

function HistoryPanel({ history }: { history: Record<string, DeliveryRecord[]> }) {
  const customers = Object.keys(history);
  const [sel, setSel] = useState("");
  const current = customers.includes(sel) ? sel : customers[0];

  if (customers.length === 0) {
    return (
      <section className="panel">
        <div className="heading">
          <div>
            <p>交付留档</p>
            <h2>客户历史</h2>
          </div>
        </div>
        <p className="empty">暂无交付记录，工单交付后在此保留每次用量。</p>
      </section>
    );
  }

  const records = [...(history[current] ?? [])].reverse();
  const totalGrams = records.reduce((s, r) => s + r.totalGrams, 0);

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>交付留档</p>
          <h2>客户历史</h2>
        </div>
        <div className="chips">
          {customers.map((c) => (
            <button key={c} className={c === current ? "chip active" : "chip"} onClick={() => setSel(c)}>
              {c}
            </button>
          ))}
        </div>
      </div>
      <p className="hint">{current} 累计交付 {records.length} 单，共用蜡 {totalGrams}g。</p>
      <div className="history-list">
        {records.map((r) => (
          <article key={r.orderId} className="history-card">
            <header>
              <strong>{r.orderId}</strong>
              <span>{r.deliveredAt} 交付 · {r.boardType} {r.lengthCm}cm · {r.edgeAngle} · 合计 {r.totalGrams}g</span>
            </header>
            <ul className="usage-list">
              {r.usages.map((u) => (
                <li key={u.id}>{u.at} · {u.waxType} · 批号 {u.batchNo} · 用量 {u.grams}g</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

/* ================= 主应用 ================= */

export default function App() {
  const [state, setState] = useState<BenchState>(loadState);
  const [filter, setFilter] = useState<Status | "全部">("全部");

  // 关掉浏览器再打开，库存、工单和历史仍在
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const totalRemaining = state.batches.reduce((s, b) => s + b.remainingGrams, 0);
  const countOf = (st: Status) => state.orders.filter((o) => o.status === st).length;
  const filteredOrders = [...state.orders]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((o) => filter === "全部" || o.status === filter);

  /* ---- 工单操作 ---- */

  const addOrder = (draft: { customer: string; boardType: string; lengthCm: number; edgeAngle: string; preference: string; damage: string }) => {
    setState((prev) => ({
      ...prev,
      orders: [...prev.orders, {
        id: uid("WO"),
        ...draft,
        status: "待备料",
        usages: [],
        shortageGrams: null,
        shortageNote: null,
        pendingNote: null,
        createdAt: now(),
        deliveredAt: null,
      }],
    }));
  };

  const deleteOrder = (orderId: string) => {
    setState((prev) => ({
      ...prev,
      orders: prev.orders.filter((o) => !(o.id === orderId && o.usages.length === 0)),
    }));
  };

  // 开工 / 再次打蜡：按板长扣库存；余量不足停在待备料并写明缺量
  const startWaxing = (orderId: string, waxType: string, batchId: string) => {
    setState((prev) => {
      const order = prev.orders.find((o) => o.id === orderId);
      const batch = prev.batches.find((b) => b.id === batchId);
      if (!order || !batch || batch.waxType !== waxType) return prev;
      // 再次打蜡必须换批号
      if (order.usages.some((u) => u.batchNo === batch.batchNo)) return prev;

      const need = requiredGrams(order.lengthCm, waxType);
      if (batch.remainingGrams < need) {
        return {
          ...prev,
          orders: prev.orders.map((o) => o.id === orderId ? {
            ...o,
            status: "待备料" as Status,
            shortageGrams: need - batch.remainingGrams,
            shortageNote: `${waxType} · 批号 ${batch.batchNo} 余量 ${batch.remainingGrams}g，需 ${need}g`,
          } : o),
        };
      }

      const usage: WaxUsage = { id: uid("U"), waxType, batchNo: batch.batchNo, grams: need, at: now() };
      return {
        ...prev,
        batches: prev.batches.map((b) =>
          b.id === batchId ? { ...b, remainingGrams: b.remainingGrams - need } : b
        ),
        orders: prev.orders.map((o) => o.id === orderId ? {
          ...o,
          status: "打蜡中" as Status,
          usages: [...o.usages, usage],
          shortageGrams: null,
          shortageNote: null,
          pendingNote: null,
        } : o),
      };
    });
  };

  const finishWaxing = (orderId: string) => {
    setState((prev) => ({
      ...prev,
      orders: prev.orders.map((o) => o.id === orderId ? { ...o, status: "已打蜡" as Status } : o),
    }));
  };

  // 改刃角 / 补记损伤：退回待复核，已扣的蜡不退还
  const changeEdge = (orderId: string, angle: string) => {
    setState((prev) => ({
      ...prev,
      orders: prev.orders.map((o) => o.id === orderId && o.status === "已打蜡" ? {
        ...o,
        status: "待复核" as Status,
        pendingNote: `改刃角：${o.edgeAngle} → ${angle}`,
        edgeAngle: angle,
      } : o),
    }));
  };

  const appendDamage = (orderId: string, note: string) => {
    setState((prev) => ({
      ...prev,
      orders: prev.orders.map((o) => o.id === orderId && o.status === "已打蜡" ? {
        ...o,
        status: "待复核" as Status,
        pendingNote: `补记损伤：${note}`,
        damage: o.damage && o.damage !== "无" ? `${o.damage}；${note}` : note,
      } : o),
    }));
  };

  const reviewPass = (orderId: string) => {
    setState((prev) => ({
      ...prev,
      orders: prev.orders.map((o) => o.id === orderId ? { ...o, status: "已打蜡" as Status, pendingNote: null } : o),
    }));
  };

  // 交付：客户历史保留每次用量
  const deliver = (orderId: string) => {
    setState((prev) => {
      const order = prev.orders.find((o) => o.id === orderId);
      if (!order || order.status !== "已打蜡") return prev;
      const deliveredAt = now();
      const record: DeliveryRecord = {
        orderId: order.id,
        deliveredAt,
        boardType: order.boardType,
        lengthCm: order.lengthCm,
        edgeAngle: order.edgeAngle,
        usages: order.usages,
        totalGrams: order.usages.reduce((s, u) => s + u.grams, 0),
      };
      return {
        ...prev,
        orders: prev.orders.map((o) => o.id === orderId ? { ...o, status: "已交付" as Status, deliveredAt } : o),
        history: {
          ...prev.history,
          [order.customer]: [...(prev.history[order.customer] ?? []), record],
        },
      };
    });
  };

  /* ---- 库存操作 ---- */

  const addBatch = (waxType: string, batchNo: string, grams: number): string | null => {
    if (state.batches.some((b) => b.waxType === waxType && b.batchNo === batchNo)) {
      return "该蜡型下批号已存在，请直接入库补货";
    }
    setState((prev) => ({
      ...prev,
      batches: [...prev.batches, { id: uid("B"), waxType, batchNo, totalGrams: grams, remainingGrams: grams }],
    }));
    return null;
  };

  const restock = (batchId: string, grams: number) => {
    setState((prev) => ({
      ...prev,
      batches: prev.batches.map((b) =>
        b.id === batchId ? { ...b, totalGrams: b.totalGrams + grams, remainingGrams: b.remainingGrams + grams } : b
      ),
    }));
  };

  const resetAll = () => {
    if (!window.confirm("确定重置为演示数据？当前库存、工单和历史都会被覆盖。")) return;
    localStorage.removeItem(STORAGE_KEY);
    setState(seedState());
  };

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62004 · 滑雪板调校店 · 旺季共享蜡材</p>
        <h1>蜡材批次排工台</h1>
        <span>
          登记板型、长度、客户偏好与底板损伤；开工前选蜡型和批号，按板长扣库存，余量不足停在待备料并写明缺量；
          改刃角或补记损伤退回待复核且已扣蜡不退还；再次打蜡须换批号；交付后客户历史保留每次用量。
          数据保存在浏览器本地，关掉再打开不丢失。
        </span>
        <div>
          <button className="ghost" onClick={resetAll}>重置演示数据</button>
        </div>
      </section>

      <section className="metrics">
        <article>
          <small>待备料工单</small>
          <strong>{countOf("待备料")}</strong>
        </article>
        <article>
          <small>打蜡中</small>
          <strong>{countOf("打蜡中")}</strong>
        </article>
        <article>
          <small>待复核</small>
          <strong>{countOf("待复核")}</strong>
        </article>
        <article>
          <small>蜡材总余量</small>
          <strong>{totalRemaining}g</strong>
        </article>
      </section>

      <section className="workspace">
        <div className="side">
          <NewOrderForm onAdd={addOrder} />
          <BatchPanel batches={state.batches} onAdd={addBatch} onRestock={restock} />
        </div>

        <section className="panel orders-panel">
          <div className="heading">
            <div>
              <p>排工</p>
              <h2>工单列表</h2>
            </div>
            <div className="chips">
              <button className={filter === "全部" ? "chip active" : "chip"} onClick={() => setFilter("全部")}>
                全部（{state.orders.length}）
              </button>
              {STATUSES.map((st) => (
                <button key={st} className={filter === st ? "chip active" : "chip"} onClick={() => setFilter(st)}>
                  {st}（{countOf(st)}）
                </button>
              ))}
            </div>
          </div>
          <div className="order-list">
            {filteredOrders.length === 0 && <p className="empty">该状态下暂无工单。</p>}
            {filteredOrders.map((o) => (
              <OrderCard
                key={o.id}
                order={o}
                batches={state.batches}
                onStart={startWaxing}
                onFinish={finishWaxing}
                onEdge={changeEdge}
                onDamage={appendDamage}
                onReviewPass={reviewPass}
                onDeliver={deliver}
                onDelete={deleteOrder}
              />
            ))}
          </div>
        </section>
      </section>

      <HistoryPanel history={state.history} />
    </main>
  );
}

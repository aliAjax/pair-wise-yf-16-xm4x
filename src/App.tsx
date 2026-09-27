import { useMemo, useState } from "react";
import "./styles.css";
import {
  BOARD_TYPES,
  ORDER_STATUSES,
  WAX_GRAMS_PER_CM,
  WAX_TYPES,
  type Order,
  type OrderStatus,
  type PersistState,
  type WaxBatch,
  type WaxType,
} from "./types";
import { clearState, loadState, waxNeedGrams } from "./storage";

type TabKey = "orders" | "stock" | "history";

interface Toast {
  kind: "ok" | "err";
  text: string;
}

function fmt(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function App() {
  const [state, setState] = useState<PersistState>(() => loadState());
  const [tab, setTab] = useState<TabKey>("orders");
  const [statusFilter, setStatusFilter] = useState<"全部" | OrderStatus>("全部");
  const [toast, setToast] = useState<Toast | null>(null);

  const notify = (kind: Toast["kind"], text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast(null), 3600);
  };

  /** 深拷贝草稿上直接改，落盘 localStorage，关浏览器后仍在 */
  const commit = (mutate: (draft: PersistState) => void) => {
    const draft: PersistState = structuredClone(state);
    mutate(draft);
    setState(draft);
  };

  const log = (order: Order, text: string) => {
    order.timeline.push({ at: Date.now(), text });
  };

  // ---------- 工单 ----------
  const createOrder = (form: {
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
  }) => {
    commit((d) => {
      d.orderSeq += 1;
      const now = Date.now();
      const order: Order = {
        ...form,
        id: `WO-${String(d.orderSeq).padStart(3, "0")}`,
        status: "待选蜡",
        shortage: null,
        usages: [],
        timeline: [{ at: now, text: `登记工单：${form.brand}，板长 ${form.lengthCm} cm` }],
        reviewDirty: false,
        createdAt: now,
        deliveredAt: null,
      };
      d.orders.unshift(order);
    });
    notify("ok", "工单已登记，等待开工选蜡");
  };

  /**
   * 开工打蜡：按板长整板扣库存（1 g/cm）。
   * 余量不足 → 不扣蜡，停在待备料并写明缺量。
   * 已扣的蜡不退还；再次打蜡必须换另一个批号。
   */
  const applyWax = (orderId: string, batchId: string) => {
    const order = state.orders.find((o) => o.id === orderId);
    if (!order) return;
    const batch = state.batches.find((b) => b.id === batchId);
    if (!batch) {
      notify("err", "请选择有效批号");
      return;
    }
    const usedLots = new Set(order.usages.map((u) => u.lotNo));
    if (usedLots.has(batch.lotNo)) {
      notify("err", `再次打蜡需换另一批号，不能重复使用 ${batch.lotNo}`);
      return;
    }
    const need = waxNeedGrams(order.lengthCm);
    let shortageGrams = 0;
    commit((d) => {
      const o = d.orders.find((x) => x.id === orderId)!;
      const b = d.batches.find((x) => x.id === batchId)!;
      if (b.grams < need) {
        shortageGrams = need - b.grams;
        o.status = "待备料";
        o.shortage = {
          batchId: b.id,
          waxType: b.waxType,
          lotNo: b.lotNo,
          need,
          have: b.grams,
          missing: shortageGrams,
          at: Date.now(),
        };
        log(o, `余量不足挂起：${b.waxType} ${b.lotNo}，需 ${need} g / 余 ${b.grams} g / 缺 ${shortageGrams} g，未扣蜡`);
        return;
      }
      b.grams -= need;
      o.usages.push({
        batchId: b.id,
        waxType: b.waxType,
        lotNo: b.lotNo,
        grams: need,
        boardLengthCm: o.lengthCm,
        at: Date.now(),
      });
      o.status = "待复核";
      o.shortage = null;
      o.reviewDirty = false;
      log(o, `打蜡扣料：${b.waxType} ${b.lotNo} −${need} g（板长 ${o.lengthCm} cm），批号余量 ${b.grams} g，已扣不退还`);
    });
    if (shortageGrams > 0) {
      notify("err", `余量不足：缺 ${shortageGrams} g，工单停在待备料，未扣蜡`);
    } else {
      notify("ok", `已按板长扣 ${need} g，工单进入待复核`);
    }
  };

  /** 打蜡后改刃角或补记损伤：退回待复核（重新复核），蜡不退还 */
  const recordReviewChange = (
    orderId: string,
    patch: { edgeSide: number; edgeBase: number; baseDamage: string; repairSpots: string }
  ) => {
    commit((d) => {
      const o = d.orders.find((x) => x.id === orderId)!;
      const parts: string[] = [];
      if (o.edgeSide !== patch.edgeSide || o.edgeBase !== patch.edgeBase) {
        parts.push(`刃角 ${o.edgeSide}°/${o.edgeBase}° → ${patch.edgeSide}°/${patch.edgeBase}°`);
      }
      if (o.baseDamage.trim() !== patch.baseDamage.trim() && patch.baseDamage.trim() !== "") {
        parts.push(`补记底板损伤：${patch.baseDamage.trim()}`);
      }
      if (o.repairSpots.trim() !== patch.repairSpots.trim() && patch.repairSpots.trim() !== "") {
        parts.push(`补记修补位置：${patch.repairSpots.trim()}`);
      }
      o.edgeSide = patch.edgeSide;
      o.edgeBase = patch.edgeBase;
      o.baseDamage = patch.baseDamage;
      o.repairSpots = patch.repairSpots;
      if (parts.length > 0) {
        o.reviewDirty = true;
        log(o, `打蜡后变更，退回待复核（蜡不退还）：${parts.join("；")}`);
      }
    });
    notify("ok", "已记录变更，工单退回待复核，已扣蜡不退还");
  };

  const confirmReview = (orderId: string) => {
    commit((d) => {
      const o = d.orders.find((x) => x.id === orderId)!;
      o.reviewDirty = false;
      log(o, "复核确认：刃角与底板损伤核对无误");
    });
    notify("ok", "复核已确认");
  };

  const deliver = (orderId: string) => {
    commit((d) => {
      const o = d.orders.find((x) => x.id === orderId)!;
      o.status = "已交付";
      o.deliveredAt = Date.now();
      log(o, `交付：客户历史保留每次用蜡（共 ${o.usages.length} 次，合计 ${o.usages.reduce((s, u) => s + u.grams, 0)} g）`);
    });
    notify("ok", "已交付，客户历史已保留每次用量");
  };

  // ---------- 库存 ----------
  const addBatch = (waxType: WaxType, lotNo: string, grams: number) => {
    const lot = lotNo.trim();
    if (!lot) {
      notify("err", "请填写批号");
      return;
    }
    if (state.batches.some((b) => b.lotNo === lot)) {
      notify("err", `批号 ${lot} 已存在，请直接对该批追加入库`);
      return;
    }
    commit((d) => {
      const id = `B-${String(d.batches.length + 1).padStart(2, "0")}-${Date.now() % 1000}`;
      d.batches.push({ id, waxType, lotNo: lot, grams, totalIn: grams, createdAt: Date.now() });
    });
    notify("ok", `新蜡批 ${waxType} ${lot}（${grams} g）已入库`);
  };

  const restock = (batchId: string, grams: number) => {
    commit((d) => {
      const b = d.batches.find((x) => x.id === batchId)!;
      b.grams += grams;
      b.totalIn += grams;
      d.orders
        .filter((o) => o.status === "待备料" && o.shortage && b.grams >= o.shortage.need && o.shortage.batchId === b.id)
        .forEach((o) => log(o, `批号 ${b.lotNo} 已补货至 ${b.grams} g，缺料齐套，可重新选蜡开工`));
    });
    notify("ok", "入库成功，相关待备料工单已提示可重新开工");
  };

  const resetDemo = () => {
    if (!window.confirm("将清空当前库存、工单与客户历史，恢复示例数据。确定吗？")) return;
    setState(clearState());
    notify("ok", "已恢复示例数据");
  };

  // ---------- 派生 ----------
  const counts = useMemo(() => {
    const c: Record<OrderStatus, number> = { 待选蜡: 0, 待备料: 0, 待复核: 0, 已交付: 0 };
    state.orders.forEach((o) => (c[o.status] += 1));
    return c;
  }, [state.orders]);

  const missingTotal = state.orders
    .filter((o) => o.status === "待备料" && o.shortage)
    .reduce((s, o) => s + (o.shortage?.missing ?? 0), 0);

  const visibleOrders = state.orders.filter((o) => statusFilter === "全部" || o.status === statusFilter);

  return (
    <main className="app">
      <header className="hero">
        <div className="hero-top">
          <p>滑雪板调校店 · 旺季共享蜡材</p>
          <button className="ghost" onClick={resetDemo}>恢复示例数据</button>
        </div>
        <h1>蜡材批次排工台</h1>
        <span>
          登记板型 / 板长 / 客户偏好 / 底板损伤；开工前选定蜡型与批号，按板长整板扣库存（{WAX_GRAMS_PER_CM} g/cm）。
          余量不足停在「待备料」并写明缺量，不扣蜡；打蜡后改刃角或补记损伤退回「待复核」，已扣蜡不退还；
          再次打蜡必须换另一批号；交付后客户历史保留每次用量。数据保存在本机浏览器，关闭再打开仍在。
        </span>
      </header>

      <section className="metrics">
        <article>
          <small>待选蜡开工</small>
          <strong>{counts["待选蜡"]}</strong>
        </article>
        <article className="warn">
          <small>待备料工单 · 总缺量</small>
          <strong>
            {counts["待备料"]} <em>{missingTotal} g</em>
          </strong>
        </article>
        <article>
          <small>待复核（打蜡完成）</small>
          <strong>{counts["待复核"]}</strong>
        </article>
        <article>
          <small>已交付 · 客户历史</small>
          <strong>{counts["已交付"]}</strong>
        </article>
      </section>

      <nav className="tabs">
        <button className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}>
          工单排工
        </button>
        <button className={tab === "stock" ? "active" : ""} onClick={() => setTab("stock")}>
          蜡材批次库存
        </button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
          客户用蜡历史
        </button>
      </nav>

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}

      {tab === "orders" && (
        <section className="tab-body">
          <NewOrderForm onCreate={createOrder} />

          <div className="panel">
            <div className="heading">
              <div>
                <p>排工看板</p>
                <h2>工单（{visibleOrders.length}）</h2>
              </div>
              <div className="chips">
                {(["全部", ...ORDER_STATUSES] as const).map((s) => (
                  <button
                    key={s}
                    className={statusFilter === s ? "chip-on" : ""}
                    onClick={() => setStatusFilter(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="order-grid">
              {visibleOrders.length === 0 && <p className="empty">该状态下暂无工单。</p>}
              {visibleOrders.map((o) => (
                <OrderCard
                  key={o.id}
                  order={o}
                  batches={state.batches}
                  onApplyWax={applyWax}
                  onReviewChange={recordReviewChange}
                  onConfirmReview={confirmReview}
                  onDeliver={deliver}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {tab === "stock" && <StockTab batches={state.batches} orders={state.orders} onAdd={addBatch} onRestock={restock} />}

      {tab === "history" && <HistoryTab orders={state.orders} />}
    </main>
  );
}

// ---------------- 新工单 ----------------
function NewOrderForm({
  onCreate,
}: {
  onCreate: (f: {
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
  }) => void;
}) {
  const blank = {
    customer: "",
    contact: "",
    brand: "",
    boardType: BOARD_TYPES[0],
    lengthCm: "156",
    edgeSide: "88",
    edgeBase: "1",
    baseDamage: "",
    repairSpots: "",
    preference: "",
  };
  const [f, setF] = useState(blank);
  const set = (k: keyof typeof blank, v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = () => {
    const len = Number(f.lengthCm);
    if (!f.customer.trim() || !f.brand.trim()) return;
    if (!(len >= 100 && len <= 220)) return;
    onCreate({
      customer: f.customer.trim(),
      contact: f.contact.trim(),
      brand: f.brand.trim(),
      boardType: f.boardType,
      lengthCm: len,
      edgeSide: Number(f.edgeSide) || 0,
      edgeBase: Number(f.edgeBase) || 0,
      baseDamage: f.baseDamage.trim(),
      repairSpots: f.repairSpots.trim(),
      preference: f.preference.trim(),
    });
    setF(blank);
  };

  return (
    <section className="panel form-panel">
      <div className="heading">
        <div>
          <p>开工登记</p>
          <h2>新工单：板子信息与客户偏好</h2>
        </div>
      </div>
      <div className="field-grid">
        <label>
          <span>客户姓名 *</span>
          <input value={f.customer} onChange={(e) => set("customer", e.target.value)} placeholder="如：刘畅" />
        </label>
        <label>
          <span>联系方式</span>
          <input value={f.contact} onChange={(e) => set("contact", e.target.value)} placeholder="手机号 / 微信" />
        </label>
        <label>
          <span>雪板品牌型号 *</span>
          <input value={f.brand} onChange={(e) => set("brand", e.target.value)} placeholder="如：Burton Custom 156" />
        </label>
        <label>
          <span>板型</span>
          <select value={f.boardType} onChange={(e) => set("boardType", e.target.value)}>
            {BOARD_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          <span>板长 cm *（决定扣蜡量，1 g/cm）</span>
          <input type="number" value={f.lengthCm} onChange={(e) => set("lengthCm", e.target.value)} />
        </label>
        <label>
          <span>侧刃角 ° / 底刃角 °</span>
          <div className="pair">
            <input type="number" step="0.5" value={f.edgeSide} onChange={(e) => set("edgeSide", e.target.value)} />
            <input type="number" step="0.5" value={f.edgeBase} onChange={(e) => set("edgeBase", e.target.value)} />
          </div>
        </label>
        <label>
          <span>底板损伤</span>
          <input value={f.baseDamage} onChange={(e) => set("baseDamage", e.target.value)} placeholder="如：中段 12cm 划痕" />
        </label>
        <label>
          <span>修补位置</span>
          <input value={f.repairSpots} onChange={(e) => set("repairSpots", e.target.value)} placeholder="如：板头 P-Tex" />
        </label>
        <label className="wide">
          <span>客户偏好（蜡型 / 刃角手感）</span>
          <input value={f.preference} onChange={(e) => set("preference", e.target.value)} placeholder="如：偏好低温蜡、弱咬雪" />
        </label>
      </div>
      <div className="form-foot">
        <button className="primary" onClick={submit}>
          登记并进入待选蜡
        </button>
      </div>
    </section>
  );
}

// ---------------- 选蜡扣料面板 ----------------
function WaxPickPanel({
  order,
  batches,
  onApplyWax,
  label,
}: {
  order: Order;
  batches: WaxBatch[];
  onApplyWax: (orderId: string, batchId: string) => void;
  label: string;
}) {
  const need = waxNeedGrams(order.lengthCm);
  const initial = useMemo<WaxType>(() => {
    const hit = WAX_TYPES.find(
      (w) => order.preference.includes(w) || order.usages.some((u) => u.waxType === w)
    );
    return (hit ?? WAX_TYPES[1]) as WaxType;
    // 只在切换工单时按偏好预填
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  const [waxType, setWaxType] = useState<WaxType>(initial);
  const [batchId, setBatchId] = useState("");
  const usedLots = order.usages.map((u) => u.lotNo);
  const usable = batches.filter((b) => b.waxType === waxType);
  const chosen = batches.find((b) => b.id === batchId);
  const rewax = order.usages.length > 0;

  return (
    <div className="action-box">
      <div className="need-line">
        本板需蜡 <strong>{need} g</strong>（{order.lengthCm} cm × {WAX_GRAMS_PER_CM} g/cm）
        {rewax && <em> · 再次打蜡，已用批号：{usedLots.join("、")}</em>}
      </div>
      <div className="wax-pick">
        <label>
          <span>蜡型</span>
          <select
            value={waxType}
            onChange={(e) => {
              setWaxType(e.target.value as WaxType);
              setBatchId("");
            }}
          >
            {WAX_TYPES.map((w) => (
              <option key={w}>{w}</option>
            ))}
          </select>
        </label>
        <label>
          <span>批号（共享蜡箱，按批扣余量）</span>
          <select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
            <option value="">选择批号…</option>
            {usable.map((b) => (
              <option key={b.id} value={b.id} disabled={usedLots.includes(b.lotNo)}>
                {b.lotNo} · 余 {b.grams} g{usedLots.includes(b.lotNo) ? "（本单已用过，须换批号）" : ""}
                {b.grams < need ? " · 余量不足" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      {chosen && (
        <p className={chosen.grams >= need ? "stock-ok" : "stock-low"}>
          {chosen.lotNo} 当前余量 {chosen.grams} g ——{" "}
          {chosen.grams >= need
            ? `扣 ${need} g 后余 ${chosen.grams - need} g`
            : `缺 ${need - chosen.grams} g，将停在待备料且不扣蜡`}
        </p>
      )}
      <button className="primary" disabled={!batchId} onClick={() => onApplyWax(order.id, batchId)}>
        {label}
      </button>
    </div>
  );
}

// ---------------- 工单卡片 ----------------
function StatusTag({ status }: { status: OrderStatus }) {
  return <span className={`tag tag-${status}`}>{status}</span>;
}

function OrderCard({
  order,
  batches,
  onApplyWax,
  onReviewChange,
  onConfirmReview,
  onDeliver,
}: {
  order: Order;
  batches: WaxBatch[];
  onApplyWax: (orderId: string, batchId: string) => void;
  onReviewChange: (
    orderId: string,
    patch: { edgeSide: number; edgeBase: number; baseDamage: string; repairSpots: string }
  ) => void;
  onConfirmReview: (orderId: string) => void;
  onDeliver: (orderId: string) => void;
}) {
  const usedLots = order.usages.map((u) => u.lotNo);

  // 复核补记表单
  const [editing, setEditing] = useState(false);
  const [showRewax, setShowRewax] = useState(false);
  const [rv, setRv] = useState({
    edgeSide: String(order.edgeSide),
    edgeBase: String(order.edgeBase),
    baseDamage: order.baseDamage,
    repairSpots: order.repairSpots,
  });

  const startEdit = () => {
    setRv({
      edgeSide: String(order.edgeSide),
      edgeBase: String(order.edgeBase),
      baseDamage: order.baseDamage,
      repairSpots: order.repairSpots,
    });
    setEditing(true);
  };

  return (
    <article className="order-card">
      <header className="card-head">
        <div>
          <h3>{order.id}</h3>
          <small>{fmt(order.createdAt)} 登记</small>
        </div>
        <StatusTag status={order.status} />
      </header>

      <dl className="board-info">
        <div><dt>客户</dt><dd>{order.customer}{order.contact ? ` · ${order.contact}` : ""}</dd></div>
        <div><dt>雪板</dt><dd>{order.brand}</dd></div>
        <div><dt>板型 / 板长</dt><dd>{order.boardType} · {order.lengthCm} cm</dd></div>
        <div><dt>刃角</dt><dd>侧 {order.edgeSide}° / 底 {order.edgeBase}°</dd></div>
        <div><dt>底板损伤</dt><dd>{order.baseDamage || "—"}</dd></div>
        <div><dt>修补位置</dt><dd>{order.repairSpots || "—"}</dd></div>
        <div className="full"><dt>客户偏好</dt><dd>{order.preference || "—"}</dd></div>
      </dl>

      {order.shortage && order.status === "待备料" && (
        <div className="shortage-box">
          <b>缺料停单（未扣蜡）</b>
          <p>
            指定 {order.shortage.waxType} 批号 {order.shortage.lotNo}：本板需 {order.shortage.need} g，
            当时余量仅 {order.shortage.have} g，<strong>缺 {order.shortage.missing} g</strong>。
          </p>
          <small>请在「蜡材批次库存」中对该批号入库，或改选其他批号后重新打蜡。</small>
        </div>
      )}

      {order.usages.length > 0 && (
        <div className="usage-box">
          <b>已扣用蜡记录（不退还）</b>
          <ul>
            {order.usages.map((u, i) => (
              <li key={i}>
                <span className="dot" />
                第 {i + 1} 次 · {u.waxType} · 批号 {u.lotNo} · <strong>{u.grams} g</strong>
                <em>（板长 {u.boardLengthCm} cm）</em> · {fmt(u.at)}
              </li>
            ))}
          </ul>
          <p className="used-lots">已用批号：{usedLots.join("、")}（再次打蜡须换另一批号）</p>
        </div>
      )}

      {(order.status === "待选蜡" || order.status === "待备料") && (
        <WaxPickPanel
          order={order}
          batches={batches}
          onApplyWax={onApplyWax}
          label={order.status === "待备料" ? "重新选蜡开工（扣库存）" : "开工打蜡（按板长扣库存）"}
        />
      )}

      {order.status === "待复核" && (
        <div className="action-box review-box">
          {order.reviewDirty ? (
            <div className="re-review">
              <b>刃角 / 损伤在打蜡后有变更，需重新复核</b>
              <p>已扣蜡不退还；复核无误后方可交付。</p>
              <button className="primary" onClick={() => onConfirmReview(order.id)}>确认复核无误</button>
            </div>
          ) : (
            <>
              <div className="review-actions">
                <button className="primary" onClick={() => onDeliver(order.id)}>
                  复核通过 · 交付（写入客户历史）
                </button>
                <button onClick={() => setShowRewax((v) => !v)}>需要再次打蜡（换另一批号，追加扣料）</button>
                <button onClick={startEdit}>改刃角 / 补记损伤（退回待复核）</button>
              </div>
              {showRewax && (
                <WaxPickPanel
                  order={order}
                  batches={batches}
                  onApplyWax={(oid, bid) => {
                    onApplyWax(oid, bid);
                    setShowRewax(false);
                  }}
                  label="再次打蜡（必须换批号，按板长追加扣料）"
                />
              )}
              {editing && (
                <div className="review-edit">
                  <label>
                    <span>侧刃角 °</span>
                    <input type="number" step="0.5" value={rv.edgeSide} onChange={(e) => setRv({ ...rv, edgeSide: e.target.value })} />
                  </label>
                  <label>
                    <span>底刃角 °</span>
                    <input type="number" step="0.5" value={rv.edgeBase} onChange={(e) => setRv({ ...rv, edgeBase: e.target.value })} />
                  </label>
                  <label className="wide">
                    <span>补记底板损伤</span>
                    <input value={rv.baseDamage} onChange={(e) => setRv({ ...rv, baseDamage: e.target.value })} />
                  </label>
                  <label className="wide">
                    <span>补记修补位置</span>
                    <input value={rv.repairSpots} onChange={(e) => setRv({ ...rv, repairSpots: e.target.value })} />
                  </label>
                  <div className="edit-btns">
                    <button
                      className="primary"
                      onClick={() => {
                        onReviewChange(order.id, {
                          edgeSide: Number(rv.edgeSide) || 0,
                          edgeBase: Number(rv.edgeBase) || 0,
                          baseDamage: rv.baseDamage,
                          repairSpots: rv.repairSpots,
                        });
                        setEditing(false);
                      }}
                    >
                      保存变更（退回待复核）
                    </button>
                    <button onClick={() => setEditing(false)}>取消</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {order.status === "已交付" && (
        <div className="delivered-box">
          已于 {order.deliveredAt ? fmt(order.deliveredAt) : "—"} 交付 · 用蜡 {order.usages.length} 次 / 合计{" "}
          {order.usages.reduce((s, u) => s + u.grams, 0)} g，已入客户历史
        </div>
      )}

      <details className="timeline">
        <summary>工单流水（{order.timeline.length}）</summary>
        <ul>
          {[...order.timeline].reverse().map((t, i) => (
            <li key={i}><time>{fmt(t.at)}</time>{t.text}</li>
          ))}
        </ul>
      </details>
    </article>
  );
}

// ---------------- 库存 ----------------
function StockTab({
  batches,
  orders,
  onAdd,
  onRestock,
}: {
  batches: WaxBatch[];
  orders: Order[];
  onAdd: (waxType: WaxType, lotNo: string, grams: number) => void;
  onRestock: (batchId: string, grams: number) => void;
}) {
  const [waxType, setWaxType] = useState<WaxType>("全温蜡");
  const [lotNo, setLotNo] = useState("");
  const [grams, setGrams] = useState("500");
  const [restockMap, setRestockMap] = useState<Record<string, string>>({});

  const waitingLots = new Map<string, number>();
  orders
    .filter((o) => o.status === "待备料" && o.shortage)
    .forEach((o) => {
      const s = o.shortage!;
      waitingLots.set(s.lotNo, (waitingLots.get(s.lotNo) ?? 0) + s.missing);
    });

  return (
    <section className="tab-body">
      <section className="panel">
        <div className="heading">
          <div>
            <p>共享蜡箱</p>
            <h2>蜡材批次库存（{batches.length} 批）</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table className="stock-table">
            <thead>
              <tr>
                <th>蜡型</th><th>批号</th><th>当前余量</th><th>累计入库</th><th>已耗</th>
                <th>待备料缺量</th><th>追加入库</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const consumed = b.totalIn - b.grams;
                const wait = waitingLots.get(b.lotNo);
                return (
                  <tr key={b.id} className={wait ? "row-wait" : b.grams < 160 ? "row-low" : ""}>
                    <td>{b.waxType}</td>
                    <td className="lot">{b.lotNo}</td>
                    <td><strong>{b.grams} g</strong></td>
                    <td>{b.totalIn} g</td>
                    <td>{consumed} g</td>
                    <td>{wait ? <span className="miss">缺 {wait} g</span> : "—"}</td>
                    <td>
                      <div className="restock">
                        <input
                          type="number"
                          value={restockMap[b.id] ?? ""}
                          placeholder="克"
                          onChange={(e) => setRestockMap((m) => ({ ...m, [b.id]: e.target.value }))}
                        />
                        <button
                          onClick={() => {
                            const g = Number(restockMap[b.id]);
                            if (g > 0) {
                              onRestock(b.id, g);
                              setRestockMap((m) => ({ ...m, [b.id]: "" }));
                            }
                          }}
                        >
                          入库
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>新蜡到货</p>
            <h2>登记新批号</h2>
          </div>
        </div>
        <div className="add-batch">
          <label>
            <span>蜡型</span>
            <select value={waxType} onChange={(e) => setWaxType(e.target.value as WaxType)}>
              {WAX_TYPES.map((w) => (
                <option key={w}>{w}</option>
              ))}
            </select>
          </label>
          <label>
            <span>批号 *</span>
            <input value={lotNo} onChange={(e) => setLotNo(e.target.value)} placeholder="如 LT-20260925" />
          </label>
          <label>
            <span>入库克数</span>
            <input type="number" value={grams} onChange={(e) => setGrams(e.target.value)} />
          </label>
          <button
            className="primary"
            onClick={() => {
              const g = Number(grams);
              if (g > 0 && lotNo.trim()) {
                onAdd(waxType, lotNo, g);
                setLotNo("");
              }
            }}
          >
            登记入库
          </button>
        </div>
      </section>
    </section>
  );
}

// ---------------- 客户历史 ----------------
function HistoryTab({ orders }: { orders: Order[] }) {
  const delivered = orders.filter((o) => o.status === "已交付");
  const groups = useMemo(() => {
    const map = new Map<string, { contact: string; events: { order: Order; idx: number; u: Order["usages"][number] }[]; grams: number }>();
    delivered.forEach((o) => {
      o.usages.forEach((u, idx) => {
        const g = map.get(o.customer) ?? { contact: o.contact, events: [], grams: 0 };
        g.contact = g.contact || o.contact;
        g.events.push({ order: o, idx, u });
        g.grams += u.grams;
        map.set(o.customer, g);
      });
    });
    return [...map.entries()].sort((a, b) => b[1].grams - a[1].grams);
  }, [delivered]);

  const [q, setQ] = useState("");
  const shown = groups.filter(([name, g]) => {
    const k = q.trim();
    if (!k) return true;
    return name.includes(k) || g.contact.includes(k);
  });

  return (
    <section className="tab-body">
      <section className="panel">
        <div className="heading">
          <div>
            <p>交付即归档</p>
            <h2>客户用蜡历史（{groups.length} 位客户 · {delivered.length} 单）</h2>
          </div>
          <input className="search" placeholder="搜客户姓名 / 联系方式" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {shown.length === 0 && (
          <p className="empty">
            {groups.length === 0 ? "还没有已交付工单；工单复核通过交付后，每次用蜡的蜡型、批号、用量都会保留在这里。" : "没有匹配的客户。"}
          </p>
        )}
        <div className="history-grid">
          {shown.map(([name, g]) => (
            <article key={name} className="history-card">
              <header>
                <h3>{name}</h3>
                <small>{g.contact || "未留联系方式"}</small>
              </header>
              <div className="h-sum">
                累计打蜡 <strong>{g.events.length}</strong> 次 · 合计 <strong>{g.grams} g</strong>
              </div>
              <ul>
                {g.events
                  .slice()
                  .sort((a, b) => b.u.at - a.u.at)
                  .map(({ order, idx, u }, i) => (
                    <li key={i}>
                      <time>{fmt(u.at)}</time>
                      <span>
                        {order.id} · {order.brand}（{u.boardLengthCm} cm）
                        <br />
                        第 {idx + 1} 次打蜡 · {u.waxType} · 批号 {u.lotNo} · <strong>{u.grams} g</strong>
                      </span>
                    </li>
                  ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

export default App;

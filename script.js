const API_BASE = "https://v2.prod.halliday.xyz";
const API_KEY = "";

const PAGE_LIMIT = 15;
const SCROLL_DEBOUNCE_MS = 3000;
const SCROLL_THRESHOLD_PX = 80;

const tbody = document.querySelector("#payments tbody");
const tableWrap = document.querySelector(".table-wrap");
const statusEl = document.getElementById("status");
const countEl = document.getElementById("count");
const refreshBtn = document.getElementById("refresh");
const loadMoreBtn = document.getElementById("load-more");
const themeToggleBtn = document.getElementById("theme-toggle");
const apiKeyWarning = document.getElementById("api-key-warning");

function isApiKeyMissing(key) {
  if (!key) return true;
  const trimmed = String(key).trim();
  if (!trimmed) return true;
  if (/YOUR_SECRET_API_KEY_HERE|YOUR_API_KEY|<jwt>|<org-id>/i.test(trimmed)) return true;
  // Bare "Bearer" with no actual token
  if (/^Bearer\s*$/i.test(trimmed)) return true;
  return false;
}

const API_KEY_MISSING = isApiKeyMissing(API_KEY);
apiKeyWarning.hidden = !API_KEY_MISSING;

const THEME_KEY = "halliday-dashboard-theme";

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeToggleBtn.textContent = theme === "dark" ? "☀️" : "🌙";
  themeToggleBtn.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
}

(function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (_) {}
  if (saved !== "dark" && saved !== "light") {
    saved = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  applyTheme(saved);
})();

themeToggleBtn.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch (_) {}
});
const modal = document.getElementById("json-modal");
const modalBody = document.getElementById("modal-body");
const modalCloseBtn = document.getElementById("modal-close");
const modalCopyBtn = document.getElementById("modal-copy");
const modalBackdrop = modal.querySelector(".modal-backdrop");

let allPayments = [];
const paymentsById = new Map();
let nextPaginationKey = null;
let isLoading = false;
let lastFetchTime = 0;
let hasMore = true;

refreshBtn.addEventListener("click", () => load({ reset: true }));
loadMoreBtn.addEventListener("click", () => load({ reset: false }));

tableWrap.addEventListener("scroll", maybeLoadMoreFromScroll);
window.addEventListener("scroll", maybeLoadMoreFromScroll);

function maybeLoadMoreFromScroll() {
  if (isLoading || !hasMore) return;
  const now = Date.now();
  if (now - lastFetchTime < SCROLL_DEBOUNCE_MS) return;

  const innerDistance = tableWrap.scrollHeight - tableWrap.scrollTop - tableWrap.clientHeight;
  const innerScrollable = tableWrap.scrollHeight > tableWrap.clientHeight + 1;
  if (innerScrollable && innerDistance <= SCROLL_THRESHOLD_PX) {
    load({ reset: false });
    return;
  }

  const pageDistance =
    document.documentElement.scrollHeight -
    window.scrollY -
    window.innerHeight;
  if (!innerScrollable && pageDistance <= SCROLL_THRESHOLD_PX) {
    load({ reset: false });
  }
}

modalCloseBtn.addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", closeModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.hidden) closeModal();
});
modalCopyBtn.addEventListener("click", () => {
  copyToClipboard(modalBody.textContent || "").then(() => {
    modalCopyBtn.textContent = "Copied!";
    setTimeout(() => (modalCopyBtn.textContent = "Copy"), 1200);
  });
});

tbody.addEventListener("click", (e) => {
  const jsonBtn = e.target.closest("button.json-btn");
  if (jsonBtn) {
    const id = jsonBtn.dataset.paymentId;
    const payment = paymentsById.get(id);
    if (payment) openModal(payment);
    return;
  }

  const cell = e.target.closest("td.copyable");
  if (!cell) return;
  const value = cell.dataset.copy;
  if (!value) return;
  copyToClipboard(value).then(() => {
    flashCopied(cell);
  });
});

function openModal(payment) {
  modalBody.textContent = JSON.stringify(payment, null, 2);
  modal.hidden = false;
  modalBody.scrollTop = 0;
}

function closeModal() {
  modal.hidden = true;
  modalBody.textContent = "";
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch (_) {
    // fall through to fallback
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(ta);
  }
}

function flashCopied(cell) {
  cell.classList.add("copied");
  setTimeout(() => cell.classList.remove("copied"), 600);
}

async function fetchPayments(paginationKey) {
  let url = `${API_BASE}/orgs/payments?limit=${PAGE_LIMIT}&category=ALL`;
  if (paginationKey) {
    url += `&pagination_key=${encodeURIComponent(paginationKey)}`;
  }
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: API_KEY,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

function shortId(id) {
  if (!id) return "—";
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function shortAsset(asset) {
  if (!asset) return "—";
  // Format: "ethereum:0xa0b8..." or "xo:0x80c1..."
  const [chain, address] = String(asset).split(":");
  if (!address) return asset;
  const addrShort = address.length > 10 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
  return `${chain}:${addrShort}`;
}

function formatAmount(amount) {
  if (amount == null || amount === "") return "—";
  const n = Number(amount);
  if (!isFinite(n)) return amount;
  // Show up to 6 sig figs but trim trailing zeros
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function renderAmountAsset(amountObj) {
  if (!amountObj) return '<span class="muted">—</span>';
  const amt = formatAmount(amountObj.amount);
  const asset = shortAsset(amountObj.asset);
  return `<div class="amt">${amt}</div><div class="mono muted" title="${escapeHtml(amountObj.asset || "")}">${escapeHtml(asset)}</div>`;
}

function renderFees(fees) {
  if (!fees || fees.total_fees == null) return '<span class="muted">—</span>';
  const amt = formatAmount(fees.total_fees);
  const cur = (fees.currency_symbol || "").toUpperCase();
  return `<span class="amt">${amt}</span> <span class="muted">${escapeHtml(cur)}</span>`;
}

function renderStatusBadge(status) {
  const safe = (status || "UNKNOWN").toUpperCase();
  const cls = `badge badge-${safe}`;
  return `<span class="${cls}">${escapeHtml(safe)}</span>`;
}

function renderFunded(funded) {
  if (funded === true) return '<span class="bool-yes">Yes</span>';
  if (funded === false) return '<span class="bool-no">No</span>';
  return '<span class="muted">—</span>';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function render(payments) {
  tbody.innerHTML = "";
  if (!payments.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="muted" style="text-align:center;padding:24px;">No payments found.</td></tr>`;
    countEl.textContent = "0 payments, load more at the bottom";
    return;
  }

  const rows = payments.map((p) => {
    const input = p.quote_request?.request?.fixed_input_amount;
    const output = p.quoted?.output_amount;
    const fees = p.quoted?.fees;
    const owner = p.owner_address || "";
    const depositAddr = p.next_instruction?.deposit_info?.[0]?.deposit_address || "";

    return `
      <tr>
        <td class="mono copyable" data-copy="${escapeHtml(p.created_at || "")}">${escapeHtml(p.created_at || "—")}</td>
        <td class="mono copyable" data-copy="${escapeHtml(p.payment_id || "")}">${escapeHtml(shortId(p.payment_id))}</td>
        <td class="mono copyable" data-copy="${escapeHtml(owner)}">${escapeHtml(owner ? shortId(owner) : "—")}</td>
        <td class="mono copyable" data-copy="${escapeHtml(depositAddr)}">${escapeHtml(depositAddr ? shortId(depositAddr) : "—")}</td>
        <td class="copyable" data-copy="${escapeHtml(p.status || "")}">${renderStatusBadge(p.status)}</td>
        <td class="copyable" data-copy="${p.funded === true ? "true" : p.funded === false ? "false" : ""}">${renderFunded(p.funded)}</td>
        <td class="copyable" data-copy="${escapeHtml(input ? `${input.amount} ${input.asset}` : "")}">${renderAmountAsset(input)}</td>
        <td class="copyable" data-copy="${escapeHtml(output ? `${output.amount} ${output.asset}` : "")}">${renderAmountAsset(output)}</td>
        <td class="copyable" data-copy="${escapeHtml(fees && fees.total_fees != null ? `${fees.total_fees} ${fees.currency_symbol || ""}`.trim() : "")}">${renderFees(fees)}</td>
        <td><button class="json-btn" data-payment-id="${escapeHtml(p.payment_id || "")}">Full JSON</button></td>
      </tr>
    `;
  });

  tbody.innerHTML = rows.join("");
  countEl.textContent = `${payments.length} payment${payments.length === 1 ? "" : "s"}` + ", load more at the bottom";
}

async function load({ reset } = { reset: true }) {
  if (isLoading) return;
  isLoading = true;
  lastFetchTime = Date.now();

  if (reset) {
    allPayments = [];
    paymentsById.clear();
    nextPaginationKey = null;
    hasMore = true;
  }

  refreshBtn.disabled = true;
  loadMoreBtn.disabled = true;
  statusEl.classList.remove("error");
  statusEl.textContent = reset ? "Loading…" : "Loading older payments…";

  try {
    const data = await fetchPayments(reset ? null : nextPaginationKey);
    const batch = data.payment_statuses || [];
    nextPaginationKey = data.next_pagination_key || null;
    hasMore = Boolean(nextPaginationKey) && batch.length > 0;

    for (const p of batch) {
      if (!paymentsById.has(p.payment_id)) {
        paymentsById.set(p.payment_id, p);
        allPayments.push(p);
      }
    }

    allPayments.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    render(allPayments);
    statusEl.textContent = hasMore ? "" : "End of results.";
  } catch (err) {
    console.error(err);
    statusEl.classList.add("error");
    statusEl.textContent = `Failed to load: ${err.message}`;
  } finally {
    isLoading = false;
    refreshBtn.disabled = false;
    loadMoreBtn.disabled = !hasMore;
    loadMoreBtn.textContent = hasMore ? "Load more" : "No more results";
    lastFetchTime = Date.now();
  }
}

if (!API_KEY_MISSING) {
  load({ reset: true });
} else {
  refreshBtn.disabled = true;
  loadMoreBtn.disabled = true;
  render([]);
}

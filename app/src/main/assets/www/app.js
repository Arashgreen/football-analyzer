/* Football Season Analyzer — frontend logic */
const $ = (s) => document.querySelector(s);
const fa = (n) => Number(n).toLocaleString("fa-IR");
const fa1 = (n) => Number(n).toLocaleString("fa-IR", { maximumFractionDigits: 2 });

const STAT_DEFS = [
  { key: "gf", label: "گل زده" },
  { key: "ga", label: "گل خورده" },
  { key: "total_shots", label: "شوت" },
  { key: "ShotsOnTarget", label: "شوت در چهارچوب" },
  { key: "Offsides", label: "آفساید" },
  { key: "corners", label: "کرنر" },
  { key: "keeper_saves", label: "سیو دروازه‌بان" },
];

const qEl = $("#q"), btn = $("#searchBtn"), sugEl = $("#suggest"),
      statusEl = $("#status"), resultsEl = $("#results"), cardsEl = $("#cards"),
      compareEl = $("#compareMode"), csvBtn = $("#csvBtn");

let searchTimer = null, activeIdx = -1, lastData = null;

// ---------- search suggestions ----------
qEl.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = qEl.value.trim();
  if (q.length < 2) { sugEl.hidden = true; return; }
  searchTimer = setTimeout(() => doSuggest(q), 350);
});
qEl.addEventListener("keydown", (e) => {
  const items = [...sugEl.querySelectorAll("li")];
  if (sugEl.hidden || !items.length) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    activeIdx = (activeIdx + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items.forEach((li, i) => li.classList.toggle("active", i === activeIdx));
  } else if (e.key === "Enter" && activeIdx >= 0) {
    e.preventDefault(); items[activeIdx].click();
  } else if (e.key === "Escape") sugEl.hidden = true;
});
document.addEventListener("click", (e) => { if (!e.target.closest(".search-box")) sugEl.hidden = true; });

btn.addEventListener("click", () => {
  const items = [...sugEl.querySelectorAll("li")];
  if (!sugEl.hidden && activeIdx >= 0 && items[activeIdx]) items[activeIdx].click();
  else if (qEl.value.trim().length >= 2) doSuggest(qEl.value.trim());
});

async function doSuggest(q) {
  try {
    const list = window.DataLayer
      ? await DataLayer.search(q)
      : await fetch(`/api/search?q=${encodeURIComponent(q)}`).then(r => r.json());
    activeIdx = -1;
    if (!list.length) { sugEl.hidden = true; return; }
    sugEl.innerHTML = "";
    for (const t of list) {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.innerHTML = `<span>${t.name}</span><span class="lg">${t.league || ""}</span>`;
      li.addEventListener("click", () => { sugEl.hidden = true; analyze(t); });
      sugEl.appendChild(li);
    }
    sugEl.hidden = false;
  } catch (_) { sugEl.hidden = true; }
}

// ---------- analyze ----------
compareEl.addEventListener("change", () => {
  render(); // re-render layout if both teams loaded
  compareEl.checked && lastData?.length === 1
    ? setStatus("تیم دوم را جستجو کنید تا کنار تیم اول قرار بگیرد.")
    : hideStatus();
});

csvBtn.addEventListener("click", downloadCsv);

async function analyze(team) {
  hideStatus();
  btn.disabled = true;
  setStatus(`در حال جمع‌آوری آمار «${team.name}» از ابتدای فصل… این کار برای هر بازی چند صدم ثانیه طول می‌کشد.`);
  try {
    const d = window.DataLayer
      ? await DataLayer.analyze(team.id)
      : await fetch(`/api/analyze?id=${team.id}`).then(r => r.json());
    lastData = lastData && compareEl.checked ? mergeTeam(lastData, d) : [d];
    hideStatus();
    render();
    if (compareEl.checked && lastData.length === 1)
      setStatus("تیم دوم را جستجو کنید تا مقایسه کامل شود.");
  } catch (e) {
    setStatus(e.message || "خطایی رخ داد؛ دوباره تلاش کنید.", true);
  } finally {
    btn.disabled = false;
  }
}

function mergeTeam(arr, d) {
  const i = arr.findIndex((x) => x.team.id === d.team.id);
  if (i >= 0) arr[i] = d; else arr.push(d);
  return arr.slice(-2);
}

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.className = "status" + (isError ? " error" : "");
  statusEl.hidden = false;
}
function hideStatus() { statusEl.hidden = true; }

// ---------- render ----------
function render() {
  if (!lastData || !lastData.length) { resultsEl.hidden = true; return; }
  resultsEl.hidden = false;
  cardsEl.className = "cards" + (lastData.length === 2 ? " two" : "");
  cardsEl.innerHTML = lastData.map(teamCard).join("");
  csvBtn.hidden = false;
}

function teamCard(d) {
  const maxB = Math.max(...d.goalBuckets.totals, 1);
  const stats = STAT_DEFS.map(({ key, label }) => `
    <div class="stat">
      <div class="lbl">${label}</div>
      <div class="total">${fa(d.totals[key])}</div>
      <div class="avg">میانگین: ${fa1(d.averages[key])} در بازی</div>
    </div>`).join("");

  const rows = d.matches.map((m) => `
    <tr>
      <td>${fa(m.date.replaceAll("-", "/"))}</td>
      <td>${m.venue}</td>
      <td class="opp">${m.opponent}</td>
      <td>${m.score}</td>
      <td class="res-${m.result === "برد" ? "W" : m.result === "باخت" ? "L" : "D"}">${m.result}</td>
      <td>${fa(m.gf)}</td>
      <td>${fa(m.ga)}</td>
      <td>${fa(m.total_shots)}</td>
      <td>${fa(m.ShotsOnTarget)}</td>
      <td>${fa(m.Offsides)}</td>
      <td>${fa(m.corners)}</td>
      <td>${fa(m.keeper_saves)}</td>
    </tr>`).join("");

  return `
  <article class="team-card">
    <div class="tc-head">
      <div>
        <h2>${d.team.name}</h2>
        <div class="meta">${d.league} · ${fa(d.played)} بازی انجام‌شده · فصل ${d.season}</div>
      </div>
      <div class="meta">آمار کامل در ${fa(d.matchesWithStats)} بازی</div>
    </div>
    <div class="tc-body">
      <div class="stat-grid">${stats}</div>
      <h3 class="sec">گل‌های زده در بازه‌های ۱۵ دقیقه‌ای (مجموع فصل)</h3>
      <div class="buckets">
        ${d.goalBuckets.labels.map((lb, i) => `
          <div class="bucket">
            <div class="bar-wrap"><div class="bar" style="height:${maxB > 0 ? Math.round(d.goalBuckets.totals[i] / maxB * 100) : 0}%"></div></div>
            <div class="b-total">${fa(d.goalBuckets.totals[i])}</div>
            <div class="b-avg">میانگین ${fa1(d.goalBuckets.avg[i])}</div>
            <div class="b-lbl">${lb}′</div>
          </div>`).join("")}
      </div>
      <h3 class="sec">بازی‌های فصل (جدیدترین اول)</h3>
      <div class="tbl-wrap">
        <table>
          <thead><tr>
            <th>تاریخ</th><th>میزبانی</th><th>حریف</th><th>نتیجه</th><th>وضعیت</th>
            <th>گل زده</th><th>گل خورده</th><th>شوت</th><th>چهارچوب</th><th>آفساید</th><th>کرنر</th><th>سیو</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  </article>`;
}

// ---------- CSV export ----------
function downloadCsv() {
  if (!lastData?.length) return;
  const head = ["team", "date", "venue", "opponent", "score", "result",
    "goals_0_15", "goals_16_30", "goals_31_45", "goals_46_60", "goals_61_75", "goals_76_90",
    "goals_for", "goals_against", "total_shots", "shots_on_target", "offsides", "corners", "keeper_saves"];
  const lines = [head.join(",")];
  for (const d of lastData)
    for (const m of d.matches)
      lines.push([d.team.name, m.date, m.venue === "خانه" ? "home" : "away", m.opponent, m.score, m.result,
        ...m.buckets, m.gf, m.ga, m.total_shots, m.ShotsOnTarget, m.Offsides, m.corners, m.keeper_saves].join(","));
  const csv = "\uFEFF" + lines.join("\n");
  if (window.AndroidBridge && AndroidBridge.saveCsv) {
    AndroidBridge.saveCsv("football-season-stats.csv", csv);
    return;
  }
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "football-season-stats.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- PWA ----------
if ("serviceWorker" in navigator && location.protocol.startsWith("http"))
  navigator.serviceWorker.register("sw.js").catch(() => {});

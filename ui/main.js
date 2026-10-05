const { invoke } = window.__TAURI__.core;

const $ = (id) => document.getElementById(id);

const bars = {
  cpu: document.querySelector("#cpu .fill"),
  gpu: document.querySelector("#gpu .fill"),
  mem: document.querySelector("#mem .fill"),
  disk: document.querySelector("#disk .fill"),
};

const GIB = 1024 ** 3;

function fmtBytes(bytes) {
  if (bytes >= GIB * 1024) return (bytes / (GIB * 1024)).toFixed(2) + " TiB";
  if (bytes >= GIB) return (bytes / GIB).toFixed(1) + " GiB";
  return (bytes / 1024 ** 2).toFixed(0) + " MiB";
}

function setBar(kind, pct) {
  const p = Math.max(0, Math.min(100, pct));
  bars[kind].classList.remove("na");
  bars[kind].style.width = p.toFixed(1) + "%";
  return p;
}

function render(s) {
  const cpu = setBar("cpu", s.cpu);
  $("cpu-value").textContent = cpu.toFixed(0) + "%";

  if (s.gpu === null || s.gpu === undefined) {
    bars.gpu.classList.add("na");
    bars.gpu.style.width = "100%";
    $("gpu-value").textContent = "N/A";
    $("gpu-sub").textContent = "unavailable";
  } else {
    const g = setBar("gpu", s.gpu);
    $("gpu-value").textContent = g.toFixed(0) + "%";
    $("gpu-sub").textContent = "Apple GPU · Device Utilization";
  }

  const memPct = s.memTotal > 0 ? (s.memUsed / s.memTotal) * 100 : 0;
  setBar("mem", memPct);
  $("mem-value").textContent = memPct.toFixed(0) + "%";
  $("mem-sub").textContent =
    fmtBytes(s.memUsed) + " / " + fmtBytes(s.memTotal) + " used";

  const diskPct = s.diskTotal > 0 ? (s.diskUsed / s.diskTotal) * 100 : 0;
  setBar("disk", diskPct);
  $("disk-value").textContent = diskPct.toFixed(0) + "%";
  $("disk-sub").textContent =
    fmtBytes(s.diskFree) + " free of " + fmtBytes(s.diskTotal);
}

async function tick() {
  try {
    render(await invoke("get_stats"));
  } catch (err) {
    console.error("get_stats failed:", err);
  }
}

tick();
setInterval(tick, 1000);

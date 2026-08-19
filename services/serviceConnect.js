function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function joinUrl(base, path) {
  return `${String(base || "").replace(/\/$/, "")}${path}`;
}

async function pingJson(url, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

function startPeerWatch({
  from,
  name,
  url,
  healthPath,
  intervalMs = 5000,
  onChange,
}) {
  const status = {
    name,
    url: url || "",
    healthUrl: url ? joinUrl(url, healthPath) : "",
    connected: false,
    lastError: null,
    connectedAt: null,
    lastCheckAt: null,
  };

  if (!url) {
    console.log(`[connect] SKIP  ${from} → ${name}  (URL not set)`);
    return status;
  }

  const target = status.healthUrl;
  let waitAttempts = 0;
  let ticking = false;

  const tick = async () => {
    if (ticking) return;
    ticking = true;
    status.lastCheckAt = new Date().toISOString();
    try {
      const res = await pingJson(target);
      if (res.ok) {
        waitAttempts = 0;
        status.lastError = null;
        if (!status.connected) {
          status.connected = true;
          status.connectedAt = status.lastCheckAt;
          console.log(`[connect] CONNECTED  ${from} → ${name}  ${target}`);
          onChange?.(status);
        }
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      const message = err.name === "AbortError" ? "timeout" : err.message;
      status.lastError = message;
      if (status.connected) {
        status.connected = false;
        status.connectedAt = null;
        console.warn(`[connect] DISCONNECTED  ${from} → ${name}  ${message}`);
        onChange?.(status);
      } else {
        waitAttempts += 1;
        if (waitAttempts === 1 || waitAttempts % 6 === 0) {
          console.log(
            `[connect] waiting for ${name} (${waitAttempts})  ${target}`
          );
        }
      }
    } finally {
      ticking = false;
    }
  };

  tick();
  setInterval(tick, intervalMs);
  return status;
}

module.exports = { joinUrl, pingJson, sleep, startPeerWatch };

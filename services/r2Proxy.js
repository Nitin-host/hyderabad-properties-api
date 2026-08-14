const express = require("express");
const { getObject } = require("./r2Service");
const router = express.Router();

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Length, Content-Range, Accept-Ranges"
  );
}

function applyR2Headers(res, obj, { isM3U8 }) {
  setCors(res);

  const contentType =
    obj.ContentType ||
    (isM3U8 ? "application/vnd.apple.mpegurl" : "application/octet-stream");
  res.setHeader("Content-Type", contentType);

  if (obj.ContentLength != null) {
    res.setHeader("Content-Length", String(obj.ContentLength));
  }
  if (obj.ContentRange) {
    res.setHeader("Content-Range", obj.ContentRange);
  }
  res.setHeader("Accept-Ranges", obj.AcceptRanges || "bytes");
  res.setHeader(
    "Cache-Control",
    isM3U8 ? "public, max-age=30" : "public, max-age=86400, immutable"
  );
}

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Express 5 compatible proxy route
 * Handles: /api/r2proxy/<any/path/here>
 */
router.get(/^\/r2proxy\/(.+)$/, async (req, res) => {
  try {
    const key = req.params[0];
    if (!key) {
      return res.status(400).json({ error: "Missing key path" });
    }

    const isM3U8 = key.endsWith(".m3u8");
    let r2Response;
    try {
      r2Response = await getObject(key, { range: req.headers.range });
    } catch (err) {
      const status = err.$metadata?.httpStatusCode || 500;
      if (status === 404 || err.name === "NoSuchKey" || err.Code === "NoSuchKey") {
        return res.status(404).json({ error: "Object not found" });
      }
      throw err;
    }

    const status = req.headers.range && !isM3U8 ? 206 : 200;
    applyR2Headers(res, r2Response, { isM3U8 });
    res.status(status);

    if (isM3U8) {
      res.removeHeader("Content-Length");
      const origin = `${req.protocol}://${req.get("host")}`;
      const basePath = `${origin}/api/r2proxy/${key.substring(
        0,
        key.lastIndexOf("/") + 1
      )}`;
      let text = await streamToString(r2Response.Body);
      text = text.replace(/([A-Za-z0-9_\-]+\.ts)/g, `${basePath}$1`);
      text = text.replace(/([A-Za-z0-9_\-]+\.m3u8)/g, `${basePath}$1`);
      res.type("application/vnd.apple.mpegurl");
      return res.send(text);
    }

    r2Response.Body.on("error", (err) => {
      console.error("R2 stream error:", err.message);
      if (!res.headersSent) {
        res.status(500).end();
      } else {
        res.destroy();
      }
    });

    req.on("close", () => {
      if (typeof r2Response.Body.destroy === "function") {
        r2Response.Body.destroy();
      }
    });

    r2Response.Body.pipe(res);
  } catch (err) {
    console.error("R2 Proxy Error:", err);
    if (!res.headersSent) {
      res
        .status(500)
        .json({ error: "Internal Server Error", details: err.message });
    }
  }
});

router.options(/^\/r2proxy\/(.+)$/, (req, res) => {
  setCors(res);
  res.status(204).end();
});

module.exports = router;

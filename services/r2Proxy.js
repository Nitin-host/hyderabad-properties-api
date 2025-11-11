// routes/r2Proxy.js
const express = require("express");
const axios = require("axios");
const { getPresignedUrl } = require("../services/r2Service");
const router = express.Router();

/**
 * ✅ Express 5 compatible proxy route
 * Handles: /api/r2proxy/<any/path/here>
 */
router.get(/^\/r2proxy\/(.+)$/, async (req, res) => {
  try {
    // ✅ Extract the full key path after /r2proxy/
    const key = req.params[0];
    if (!key) {
      return res.status(400).json({ error: "Missing key path" });
    }

    // 🔐 Generate presigned URL
    const presignedUrl = await getPresignedUrl(key);

    // 📥 Fetch file from R2
    const isM3U8 = key.endsWith(".m3u8");
    const r2Response = await axios.get(presignedUrl, {
      responseType: isM3U8 ? "text" : "stream",
      validateStatus: () => true,
    });

    if (r2Response.status !== 200) {
      return res
        .status(r2Response.status)
        .json({ error: `Failed to fetch from R2: ${r2Response.statusText}` });
    }

    // 🌐 CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Range");
    res.setHeader(
      "Content-Type",
      r2Response.headers["content-type"] || "application/octet-stream"
    );

    // 🎥 Special handling for playlists
    if (isM3U8) {
      let text = r2Response.data;
      const basePath = `/api/r2proxy/${key.substring(
        0,
        key.lastIndexOf("/") + 1
      )}`;

      // Rewrite segment references
      text = text.replace(/([A-Za-z0-9_\-]+\.ts)/g, `${basePath}$1`);
      text = text.replace(/([A-Za-z0-9_\-]+\.m3u8)/g, `${basePath}$1`);

      res.type("application/vnd.apple.mpegurl");
      return res.send(text);
    }

    // 📡 Stream other files
    r2Response.data.pipe(res);
  } catch (err) {
    console.error("R2 Proxy Error:", err);
    res
      .status(500)
      .json({ error: "Internal Server Error", details: err.message });
  }
});

module.exports = router;

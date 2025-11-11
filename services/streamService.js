// services/streamService.js
const axios = require("axios");
const FormData = require("form-data");
require("dotenv").config();

const BASE_URL = `${process.env.CLOUDFLARE_STREAM_API_BASE}/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/stream`;

/**
 * Upload a video to Cloudflare Stream
 * @param {ReadableStream} fileStream - The video stream
 * @param {String} fileName - File name for Cloudflare
 */
async function uploadToCloudflareStream(fileStream, fileName) {
  try {
    const form = new FormData();
    form.append("file", fileStream, fileName);

    const res = await axios.post(BASE_URL, form, {
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_STREAM_API_TOKEN}`,
        ...form.getHeaders(),
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    return {
      success: true,
      data: res.data.result, // { uid, status: { state }, ... }
    };
  } catch (err) {
    console.error(
      "❌ Stream upload failed:",
      err.response?.data || err.message
    );
    return { success: false, error: err.response?.data || err.message };
  }
}

/**
 * Get video details by UID
 */
async function getStreamVideoDetails(uid) {
  try {
    const res = await axios.get(`${BASE_URL}/${uid}`, {
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_STREAM_API_TOKEN}`,
      },
    });
    return { success: true, data: res.data.result };
  } catch (err) {
    console.error(
      "❌ Failed to get video details:",
      err.response?.data || err.message
    );
    return { success: false, error: err.response?.data || err.message };
  }
}

/**
 * Delete a video by UID
 */
async function deleteStreamVideo(uid) {
  try {
    await axios.delete(`${BASE_URL}/${uid}`, {
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_STREAM_API_TOKEN}`,
      },
    });
    return { success: true };
  } catch (err) {
    console.error(
      "❌ Failed to delete Stream video:",
      err.response?.data || err.message
    );
    return { success: false, error: err.response?.data || err.message };
  }
}

module.exports = {
  uploadToCloudflareStream,
  getStreamVideoDetails,
  deleteStreamVideo,
};

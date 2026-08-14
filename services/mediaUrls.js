const User = require("../models/User");
const { getPresignedUrl } = require("./r2Service");

let superAdminCache = { value: null, expiresAt: 0 };
const SUPER_ADMIN_TTL_MS = 5 * 60 * 1000;

async function getCachedSuperAdmin() {
  const now = Date.now();
  if (superAdminCache.value && now < superAdminCache.expiresAt) {
    return superAdminCache.value;
  }

  const superAdmin = await User.findOne({ role: "super_admin" })
    .select("_id name email phone role")
    .lean();

  superAdminCache = {
    value: superAdmin,
    expiresAt: now + SUPER_ADMIN_TTL_MS,
  };

  return superAdmin;
}

function toPlain(doc) {
  if (!doc) return doc;
  return typeof doc.toObject === "function" ? doc.toObject() : doc;
}

async function mapImages(images = [], { includeProxy = false, limit } = {}) {
  const list = (images || []).filter((img) => img && img.key);
  const sliced = typeof limit === "number" ? list.slice(0, limit) : list;

  return Promise.all(
    sliced.map(async (img) => {
      const obj = toPlain(img);
      const result = {
        ...obj,
        presignUrl: await getPresignedUrl(obj.key),
      };
      if (includeProxy) {
        result.proxyUrl = `/api/r2proxy/${obj.key}`;
      }
      return result;
    })
  );
}

function isPlayableVideo(vid) {
  const obj = toPlain(vid);
  if (!obj?.masterKey) return false;
  const status = (obj.videoStatus || "").toLowerCase();
  return status === "completed" || status === "ready";
}

async function mapVideos(
  videos = [],
  { full = true, qualities = false, playableOnly = false } = {}
) {
  const list = playableOnly
    ? (videos || []).filter(isPlayableVideo)
    : videos || [];

  return Promise.all(
    list.map(async (vid) => {
      const obj = toPlain(vid);
      const result = {
        ...obj,
        thumbnail: obj.thumbnailKey
          ? await getPresignedUrl(obj.thumbnailKey)
          : null,
        thumbnailProxyUrl: obj.thumbnailKey
          ? `/api/r2proxy/${obj.thumbnailKey}`
          : null,
      };

      if (!full) {
        return result;
      }

      result.masterProxyUrl = obj.masterKey
        ? `/api/r2proxy/${obj.masterKey}`
        : null;

      if (qualities && obj.qualityKeys) {
        result.qualityProxyUrls = {};
        for (const [quality, key] of Object.entries(obj.qualityKeys)) {
          if (!key) continue;
          result.qualityProxyUrls[quality] = `/api/r2proxy/${key}`;
        }
      }

      return result;
    })
  );
}

module.exports = {
  getCachedSuperAdmin,
  mapImages,
  mapVideos,
};

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
require("dotenv").config();

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const R2_BUCKET = process.env.R2_BUCKET_NAME;

// URL cache to avoid regenerating URLs for the same keys
const urlCache = new Map();
const URL_CACHE_TTL = 3600000; // 1 hour in milliseconds

// Upload buffer
async function uploadBuffer(
  buffer,
  key,
  contentType = "application/octet-stream"
) {
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });
  await r2.send(command);
  return { key }; // only key stored in DB
}

// Generate presigned URL with caching
async function getPresignedUrl(key, expiresIn = 604800) {
  // Check if URL is in cache and not expired
  const now = Date.now();
  const cachedItem = urlCache.get(key);
  
  if (cachedItem && now < cachedItem.expiresAt) {
    return cachedItem.url;
  }
  
  // Generate new URL if not in cache or expired
  const command = new GetObjectCommand({ Bucket: R2_BUCKET, Key: key });
  const url = await getSignedUrl(r2, command, { expiresIn });
  
  // Store in cache with expiration (set to expire before the actual URL expires)
  urlCache.set(key, {
    url,
    expiresAt: now + Math.min(expiresIn * 1000 * 0.9, URL_CACHE_TTL) // 90% of expiresIn or 1 hour, whichever is less
  });
  
  return url;
}

// Delete object
async function deleteFile(key) {
  const command = new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key });
  await r2.send(command);
  // Remove from cache if exists
  urlCache.delete(key);
  return true;
}

// Clear expired cache entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of urlCache.entries()) {
    if (now >= value.expiresAt) {
      urlCache.delete(key);
    }
  }
}, 60000); // Run every minute

module.exports = { uploadBuffer, getPresignedUrl, deleteFile };

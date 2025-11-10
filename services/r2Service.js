const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
require("dotenv").config();

// -----------------------------------------------------
// Cloudflare R2 Setup
// -----------------------------------------------------
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const R2_BUCKET = process.env.R2_BUCKET_NAME;

// -----------------------------------------------------
// URL Cache Setup
// -----------------------------------------------------
const urlCache = new Map();
const URL_CACHE_TTL = 3600000; // 1 hour in milliseconds

// -----------------------------------------------------
// Upload a Readable Stream to R2
// -----------------------------------------------------
async function uploadStream(stream, key, contentType) {
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: stream,
    ContentType: contentType || "application/octet-stream",
  });
  await r2.send(command);
  return { key };
}

// -----------------------------------------------------
// Upload a Buffer to R2
// -----------------------------------------------------
async function uploadBuffer(buffer, key, contentType) {
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType:
      contentType ||
      (key.endsWith(".mp4") ? "video/mp4" : "application/octet-stream"),
  });
  await r2.send(command);
  return { key };
}

// -----------------------------------------------------
// Generate Presigned URL (cached for performance)
// -----------------------------------------------------
async function getPresignedUrl(key, expiresIn = 604800) {
  const now = Date.now();
  const cachedItem = urlCache.get(key);

  if (cachedItem && now < cachedItem.expiresAt) {
    return cachedItem.url;
  }

  const command = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ResponseCacheControl: "no-cache",
    ResponseContentType: key.endsWith(".m3u8")
      ? "application/x-mpegURL"
      : undefined,
    ResponseHeaderOverrides: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });

  const url = await getSignedUrl(r2, command, { expiresIn });

  urlCache.set(key, {
    url,
    expiresAt: now + Math.min(expiresIn * 1000 * 0.9, URL_CACHE_TTL),
  });

  return url;
}

// -----------------------------------------------------
// Delete a Single Object from R2
// -----------------------------------------------------
async function deleteFile(key) {
  const command = new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key });
  await r2.send(command);
  urlCache.delete(key);
  return true;
}

// -----------------------------------------------------
// Delete Entire HLS Video Set (m3u8 + ts + thumbnails)
// -----------------------------------------------------
async function deleteVideoSet(propertyId, options = { dryRun: false }) {
  const prefix = `properties/${propertyId}/videos/`;
  let deletedCount = 0;
  let continuationToken = undefined;

  try {
    console.log(`🧹 Starting deletion for: ${prefix}`);
    if (options.dryRun)
      console.log("⚙️ DRY RUN MODE — no files will be deleted.");

    do {
      const listCmd = new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });
      const listed = await r2.send(listCmd);

      if (!listed.Contents || listed.Contents.length === 0) {
        if (!continuationToken) {
          console.log(`ℹ️ No files found for ${prefix}`);
        }
        break;
      }

      const keys = listed.Contents.map((obj) => obj.Key);
      console.log(`🧾 Found ${keys.length} files:`);
      keys.forEach((k) => console.log("   •", k));

      if (!options.dryRun) {
        const deleteCmd = new DeleteObjectsCommand({
          Bucket: R2_BUCKET,
          Delete: {
            Objects: keys.map((key) => ({ Key: key })),
            Quiet: true,
          },
        });
        await r2.send(deleteCmd);

        // Remove from URL cache
        for (const key of keys) {
          urlCache.delete(key);
        }

        deletedCount += keys.length;
      }

      continuationToken = listed.IsTruncated
        ? listed.NextContinuationToken
        : undefined;
    } while (continuationToken);

    if (options.dryRun) {
      console.log(
        `🧪 DRY RUN COMPLETE — ${deletedCount} files listed, none deleted.`
      );
    } else if (deletedCount > 0) {
      console.log(
        `✅ Deleted ${deletedCount} files (m3u8 + ts + thumbnails) for ${propertyId}`
      );
    } else {
      console.log(`ℹ️ No video files found for property ${propertyId}`);
    }

    return { deleted: deletedCount, dryRun: !!options.dryRun };
  } catch (err) {
    console.error(
      `❌ Failed to delete video set for ${propertyId}:`,
      err.message
    );
    throw err;
  }
}

// -----------------------------------------------------
// Cleanup Cache Periodically
// -----------------------------------------------------
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of urlCache.entries()) {
    if (now >= value.expiresAt) {
      urlCache.delete(key);
    }
  }
}, 60000); // Every minute

// -----------------------------------------------------
// Exports
// -----------------------------------------------------
module.exports = {
  uploadStream,
  uploadBuffer,
  getPresignedUrl,
  deleteFile,
  deleteVideoSet,
};
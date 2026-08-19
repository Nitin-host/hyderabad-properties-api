const fs = require("fs");
const { pipeline } = require("stream/promises");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
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
    ResponseCacheControl: key.endsWith(".m3u8")
      ? "public, max-age=30"
      : "public, max-age=86400",
    ResponseContentType: key.endsWith(".m3u8")
      ? "application/x-mpegURL"
      : undefined,
  });

  const url = await getSignedUrl(r2, command, { expiresIn });

  urlCache.set(key, {
    url,
    expiresAt: now + Math.min(expiresIn * 1000 * 0.9, URL_CACHE_TTL),
  });

  return url;
}

async function getObject(key, { range } = {}) {
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ...(range ? { Range: range } : {}),
  });
  return r2.send(command);
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

async function deletePrefix(prefix, options = {}) {
  const dryRun = !!options.dryRun;
  const except = new Set((options.exceptKeys || []).filter(Boolean));
  let deletedCount = 0;
  let continuationToken = undefined;

  try {
    console.log(`🧹 Starting deletion for: ${prefix}`);
    if (dryRun) console.log("⚙️ DRY RUN MODE — no files will be deleted.");

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

      const keys = listed.Contents.map((obj) => obj.Key).filter(
        (key) => key && !except.has(key)
      );

      if (keys.length === 0) {
        continuationToken = listed.IsTruncated
          ? listed.NextContinuationToken
          : undefined;
        continue;
      }

      console.log(`🧾 Found ${keys.length} files under ${prefix}`);

      if (!dryRun) {
        const deleteCmd = new DeleteObjectsCommand({
          Bucket: R2_BUCKET,
          Delete: {
            Objects: keys.map((key) => ({ Key: key })),
            Quiet: true,
          },
        });
        await r2.send(deleteCmd);

        for (const key of keys) {
          urlCache.delete(key);
        }

        deletedCount += keys.length;
      }

      continuationToken = listed.IsTruncated
        ? listed.NextContinuationToken
        : undefined;
    } while (continuationToken);

    if (dryRun) {
      console.log(
        `🧪 DRY RUN COMPLETE — ${deletedCount} files listed, none deleted.`
      );
    } else if (deletedCount > 0) {
      console.log(`✅ Deleted ${deletedCount} files for ${prefix}`);
    }

    return { deleted: deletedCount, dryRun };
  } catch (err) {
    console.error(`❌ Failed to delete prefix ${prefix}:`, err.message);
    throw err;
  }
}

async function deletePrefixes(prefixes, options = {}) {
  let deleted = 0;
  for (const prefix of prefixes) {
    const result = await deletePrefix(prefix, options);
    deleted += result.deleted;
  }
  return { deleted, dryRun: !!options.dryRun };
}

// HLS + source uploads for a property
async function deleteVideoSet(propertyId, options = {}) {
  return deletePrefixes(
    [
      `properties/${propertyId}/videos/`,
      `properties/${propertyId}/source/`,
    ],
    options
  );
}

// Images + HLS + source (and any leftover objects under the property)
async function deletePropertyMedia(propertyId, options = {}) {
  return deletePrefix(`properties/${propertyId}/`, options);
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
async function createMultipartUpload(key, contentType) {
  const command = new CreateMultipartUploadCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ContentType: contentType || "video/mp4",
  });
  const result = await r2.send(command);
  return { uploadId: result.UploadId, key };
}

async function uploadPart({ key, uploadId, partNumber, body }) {
  const command = new UploadPartCommand({
    Bucket: R2_BUCKET,
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
    Body: body,
  });
  const result = await r2.send(command);
  return { etag: result.ETag, partNumber };
}

async function presignUploadPart({
  key,
  uploadId,
  partNumber,
  expiresIn = 7200,
}) {
  const command = new UploadPartCommand({
    Bucket: R2_BUCKET,
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
  });
  const url = await getSignedUrl(r2, command, { expiresIn });
  return { partNumber, url };
}

async function presignUploadParts({
  key,
  uploadId,
  partCount,
  expiresIn = 7200,
}) {
  const parts = await Promise.all(
    Array.from({ length: partCount }, (_, i) =>
      presignUploadPart({
        key,
        uploadId,
        partNumber: i + 1,
        expiresIn,
      })
    )
  );
  return parts;
}

async function completeMultipartUpload({ key, uploadId, parts }) {
  const command = new CompleteMultipartUploadCommand({
    Bucket: R2_BUCKET,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: {
      Parts: parts
        .map((p) => {
          let etag = p.ETag || p.etag;
          if (etag && !String(etag).startsWith('"')) {
            etag = `"${etag}"`;
          }
          return {
            ETag: etag,
            PartNumber: Number(p.PartNumber || p.partNumber),
          };
        })
        .sort((a, b) => a.PartNumber - b.PartNumber),
    },
  });
  await r2.send(command);
  return { key };
}

async function abortMultipartUpload({ key, uploadId }) {
  const command = new AbortMultipartUploadCommand({
    Bucket: R2_BUCKET,
    Key: key,
    UploadId: uploadId,
  });
  await r2.send(command);
  return true;
}

async function downloadObjectToFile(key, destPath) {
  const command = new GetObjectCommand({ Bucket: R2_BUCKET, Key: key });
  const result = await r2.send(command);
  await pipeline(result.Body, fs.createWriteStream(destPath));
  return destPath;
}

module.exports = {
  uploadStream,
  uploadBuffer,
  getPresignedUrl,
  getObject,
  deleteFile,
  deletePrefix,
  deleteVideoSet,
  deletePropertyMedia,
  createMultipartUpload,
  uploadPart,
  presignUploadPart,
  presignUploadParts,
  completeMultipartUpload,
  abortMultipartUpload,
  downloadObjectToFile,
};
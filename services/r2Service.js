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

// Generate presigned URL
async function getPresignedUrl(key, expiresIn = 604800) {
  const command = new GetObjectCommand({ Bucket: R2_BUCKET, Key: key });
  return await getSignedUrl(r2, command, { expiresIn });
}

// Delete object
async function deleteFile(key) {
  const command = new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key });
  await r2.send(command);
  return true;
}

module.exports = { uploadBuffer, getPresignedUrl, deleteFile };

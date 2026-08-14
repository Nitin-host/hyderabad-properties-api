import http from "k6/http";
import { check, fail, sleep } from "k6";
import { FormData } from "https://jslib.k6.io/formdata/0.0.2/index.js";

const BASE = __ENV.API_BASE || "http://localhost:5000/api";
const PART_SIZE = 8 * 1024 * 1024;
const VIDEO_PATH = __ENV.VIDEO_PATH;
const videoBin = VIDEO_PATH ? open(VIDEO_PATH, "b") : null;

export const options = {
  vus: 1,
  iterations: 1,
};

function authHeaders(token, extra) {
  return Object.assign(
    {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    extra || {}
  );
}

function json(res) {
  try {
    return res.json();
  } catch (e) {
    return null;
  }
}

function login() {
  const email = __ENV.EMAIL;
  const password = __ENV.PASSWORD;
  if (!email || !password) fail("EMAIL and PASSWORD env vars are required");

  const res = http.post(
    `${BASE}/auth/login`,
    JSON.stringify({ email, password }),
    { headers: { "Content-Type": "application/json" }, timeout: "60s" }
  );
  const body = json(res);
  if (!body || !body.success) {
    fail(`Login failed: ${res.status} ${res.body}`);
  }
  if (body.otpRequired) {
    const otp = __ENV.OTP;
    if (!otp) fail("Admin OTP required. Pass -e OTP=<code>");
    const otpRes = http.post(
      `${BASE}/auth/verify-admin-otp`,
      JSON.stringify({ email, otp }),
      { headers: { "Content-Type": "application/json" }, timeout: "60s" }
    );
    const otpBody = json(otpRes);
    if (!otpBody || !otpBody.success || !otpBody.data || !otpBody.data.token) {
      fail(`OTP verify failed: ${otpRes.status} ${otpRes.body}`);
    }
    return otpBody.data.token;
  }
  if (!body.data || !body.data.token) {
    fail(`Login did not return a token: ${res.body}`);
  }
  return body.data.token;
}

function createProperty(token) {
  const payload = {
    title: `k6 chunked upload ${Date.now()}`,
    description: "Automated k6 test property for large chunked video upload.",
    propertyType: "Apartment",
    location: "Hyderabad, Telangana",
    landmarks: "Near HITEC City",
    price: 1000000,
    size: 1200,
    sizeUnit: "sqft",
    maintenance: 0,
    listedBy: "owner",
    bedrooms: "2BHK",
    bathrooms: 2,
    status: "For Sale",
    furnished: "Unfurnished",
    parking: "none",
    availability: "immediate",
  };
  const res = http.post(`${BASE}/properties`, JSON.stringify(payload), {
    headers: authHeaders(token),
    timeout: "60s",
  });
  const body = json(res);
  if (!body || !body.success || !body.data || !body.data._id) {
    fail(`Create property failed: ${res.status} ${res.body}`);
  }
  return body.data._id;
}

function uploadChunks(token, propertyId) {
  if (!videoBin) fail("VIDEO_PATH is required");
  const fileSize = videoBin.byteLength;
  const partCount = Math.ceil(fileSize / PART_SIZE);
  console.log(`Uploading ${fileSize} bytes in ${partCount} parts of 8MB`);

  const initRes = http.post(
    `${BASE}/properties/${propertyId}/video/initiate`,
    JSON.stringify({
      fileName: "k6-large.mp4",
      fileSize,
      contentType: "video/mp4",
    }),
    { headers: authHeaders(token), timeout: "60s" }
  );
  const initBody = json(initRes);
  if (!initBody || !initBody.success || !initBody.data) {
    fail(`Initiate failed: ${initRes.status} ${initRes.body}`);
  }
  const { uploadId, key, partSize } = initBody.data;
  const size = partSize || PART_SIZE;
  const parts = [];

  for (let i = 0; i < partCount; i++) {
    const start = i * size;
    const end = Math.min(fileSize, start + size);
    const chunk = videoBin.slice(start, end);
    const fd = new FormData();
    fd.append("chunk", http.file(chunk, `part-${i + 1}`, "application/octet-stream"));
    fd.append("uploadId", uploadId);
    fd.append("key", key);
    fd.append("partNumber", String(i + 1));

    const partRes = http.put(
      `${BASE}/properties/${propertyId}/video/part`,
      fd.body(),
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "multipart/form-data; boundary=" + fd.boundary,
        },
        timeout: "180s",
      }
    );
    const partBody = json(partRes);
    const ok = check(partRes, {
      [`part ${i + 1} uploaded`]: (r) => r.status === 200 && partBody && partBody.success,
    });
    if (!ok || !partBody.data || !partBody.data.etag) {
      fail(`Part ${i + 1} failed: ${partRes.status} ${partRes.body}`);
    }
    parts.push({ PartNumber: i + 1, ETag: partBody.data.etag });
    console.log(`uploaded part ${i + 1}/${partCount}`);
  }

  const completeRes = http.post(
    `${BASE}/properties/${propertyId}/video/complete`,
    JSON.stringify({
      uploadId,
      key,
      fileName: "k6-large.mp4",
      parts,
    }),
    { headers: authHeaders(token), timeout: "180s" }
  );
  const completeBody = json(completeRes);
  const done = check(completeRes, {
    "complete accepted": (r) =>
      (r.status === 202 || r.status === 200) && completeBody && completeBody.success,
  });
  if (!done) fail(`Complete failed: ${completeRes.status} ${completeRes.body}`);
  console.log(`Video queued for property ${propertyId}`);
}

export default function () {
  const token = login();
  const propertyId = __ENV.PROPERTY_ID || createProperty(token);
  uploadChunks(token, propertyId);
  sleep(1);
}

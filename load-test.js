import http from "k6/http";
import { check, sleep } from "k6";

// Load test files into memory (replace paths with your local test files, or base64 encode)
// For large files, consider pointing to files or using k6 extensions.
const imageFile = open("C:/Users/lenovo/Downloads/Environment Day (1080 x 1350 px).png", "b");
const videoFile = open(
  "C:/Users/lenovo/Downloads/100MB_1080P_THETESTDATA.COM_mov.mov",
  "b"
);

export let options = {
  vus: 15, // number of virtual users
  iterations: 15, // test duration
};

// const BASE_URL = "https://hyderabad-properties-api.up.railway.app";
const BASE_URL = "http://localhost:5000";
// const AUTH_TOKEN =
//   "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4ZWZiY2ZjNmIzOGVkYWFjNGRjODJkYiIsImlhdCI6MTc2MDU0MjAwMSwiZXhwIjoxNzYzMTM0MDAxfQ.elXTA4QEuUMWm_SU6CR1Z2eQOVtlf9UpXV0G8_Jay6s"; // Replace with your token

const AUTH_TOKEN =
  "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4ZTY3NjE2ZGNkMjZmOGVhNTE3NGI1ZSIsImlhdCI6MTc2MTc2MjYxMiwiZXhwIjoxNzY0MzU0NjEyfQ.0c8tZkFGxoJjij4clzEgXnvIZVe6M9jQ8r5s-odDLx8";


export default function () {
  // 1. Create property JSON payload
  const createPayload = JSON.stringify({
    title: `Test Property by VU ${__VU}`,
    description:
      "Spacious 1BHK apartment with premium amenities in a gated community. Close to IT hub and shopping centers.",
    propertyType: "Apartment",
    price: 50000 + __VU * 5000,
    size: 1000 + __VU * 100,
    sizeUnit: "sqft",
    maintenance: 3500,
    listedBy: "agent",
    brokerCharge: "1 month",
    totalFloors: 12,
    bedrooms: "1BHK",
    bathrooms: 1,
    balconies: 0,
    furnished: "Semi Furnished",
    parking: "none",
    securityDeposit: 170000,
    landmarks: "Near Infosys Campus, 2km from Gachibowli Flyover",
    location: "Gachibowli",
    flooring: "Vitrified",
    overlooking: "Garden",
    ageOfConstruction: "Less than 5 years",
    additionalRooms: "Study Room",
    waterAvailability: "24 Hours Available",
    statusOfElectricity: "No Power Issues",
    lift: 2,
    amenities: [
      "Swimming Pool",
      "Gym",
      "Children's Play Area",
      "Security",
      "Power Backup",
    ],
    status: "For Rent",
    availability: "immediate",
  });

  const params = {
    headers: {
      "Content-Type": "application/json",
      Authorization: AUTH_TOKEN,
    },
  };

  // POST create property
  let res = http.post(`${BASE_URL}/api/properties`, createPayload, params);
  check(res, { "create property status 201": (r) => r.status === 201 });

  let propertyId;
  try {
    const parsed = res.json();
    propertyId = parsed.data?._id || parsed._id || parsed.property?._id;
  } catch (e) {
    console.error("Failed to parse JSON:", e.message);
  }
  console.log("Extracted propertyId:", propertyId);


  if (!propertyId) {
    console.error("Failed to get propertyId from create response");
    return;
  }

  // 2. Upload image using multipart/form-data
  let imageFormData = {
    images: http.file(imageFile, `sample-image1.jpg`, "image/jpeg"),
  };

  res = http.post(
    `${BASE_URL}/api/properties/${propertyId}/images`,
    imageFormData,
    {
      headers: { Authorization: AUTH_TOKEN },
      timeout: "120s",
    }
  );
  check(res, { "image upload status 200": (r) => r.status === 200 });

  // 3. Upload video using multipart/form-data
  // let videoFormData = {
  //   videos: http.file(videoFile, `sample-video${__VU}.mp4`, "video/mp4"),
  // };

  let videoFormData = {
    videos: http.file(videoFile, `sample-video${__VU}.mov`, "video/quicktime"),
  };


  res = http.post(
    `${BASE_URL}/api/properties/${propertyId}/video`,
    videoFormData,
    {
      headers: { Authorization: AUTH_TOKEN },
      timeout: '240s'
    }
  );
  check(res, { "video upload status 200": (r) => r.status === 200 });

  sleep(1); // wait a bit before next iteration
}
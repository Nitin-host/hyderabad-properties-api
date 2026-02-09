import http from "k6/http";
import { check, sleep } from "k6";

// Base API info
const BASE_URL = "https://hyderabad-properties-api.up.railway.app";
const AUTH_TOKEN =
  "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4ZWZiY2ZjNmIzOGVkYWFjNGRjODJkYiIsImlhdCI6MTc2MDU0MjAwMSwiZXhwIjoxNzYzMTM0MDAxfQ.elXTA4QEuUMWm_SU6CR1Z2eQOVtlf9UpXV0G8_Jay6s";

// Load both videos in init context (runs once per test)
const videos = [
  // open("C:/Users/lenovo/Downloads/4k_156mb.mp4", "b"),
  open("C:/Users/lenovo/Downloads/3BHK(164MB).mp4", "b"),
];

// Test configuration
export let options = {
  vus: 4,
  iterations: 4,
};

export default function () {
  // Randomly select one of the two videos for this iteration
  const randomIndex = Math.floor(Math.random() * videos.length);
  const selectedVideo = videos[randomIndex];

  // Create property payload
  const createPayload = JSON.stringify({
    title: `Test Property by VU ${__VU}`,
    description: "Sample property created by k6",
    propertyType: "Apartment",
    price: 50000 + __VU * 5000,
    size: 1000 + __VU * 100,
    sizeUnit: "sqft",
    maintenance: 2000,
    listedBy: "agent",
    brokerCharge: "1 month",
    totalFloors: 5,
    bedrooms: "2BHK",
    bathrooms: 2,
    balconies: 1,
    furnished: "Semi Furnished",
    parking: "none",
    securityDeposit: 100000,
    landmarks: "Near Test Location",
    location: "Test City",
    flooring: "Tiles",
    overlooking: "Park",
    ageOfConstruction: "Less than 5 years",
    additionalRooms: "Study Room",
    waterAvailability: "24 Hours Available",
    statusOfElectricity: "No Power Issues",
    lift: 1,
    amenities: ["Gym", "Parking"],
    status: "For Rent",
    availability: "immediate",
  });

  // Create property
  const createRes = http.post(`${BASE_URL}/api/properties`, createPayload, {
    headers: {
      "Content-Type": "application/json",
      Authorization: AUTH_TOKEN,
    },
  });

  check(createRes, { "property created": (r) => r.status === 201 });

  const propertyId = createRes.json("data._id");
  if (!propertyId) {
    console.error(`VU ${__VU}: Failed to create property`);
    return;
  }

  // Upload random video
  const videoFormData = {
    videos: http.file(
      selectedVideo,
      `video_vu_${__VU}_${randomIndex}.mp4`,
      "video/mp4"
    ),
  };

  const videoRes = http.post(
    `${BASE_URL}/api/properties/${propertyId}/video`,
    videoFormData,
    {
      headers: {
        Authorization: AUTH_TOKEN,
      },
      // timeout: "240s",
    }
  );

  check(videoRes, { "video upload status 200": (r) => r.status === 200 });

  if (videoRes.status !== 200) {
    console.error(`VU ${__VU}: Video upload failed for property ${propertyId}`);
  }

  sleep(1);
}
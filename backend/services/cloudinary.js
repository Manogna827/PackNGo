import { v2 as cloudinary } from "cloudinary";
import { HttpError } from "../lib/errors.js";

export function ensureCloudinaryConfigured() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new HttpError(503, "Image uploads are not configured yet. Add the Cloudinary server credentials.");
  }
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true
  });
}

export function uploadImage(buffer) {
  ensureCloudinaryConfigured();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      folder: "packngo/trip-documents",
      resource_type: "image",
      allowed_formats: ["jpg", "jpeg", "png", "webp"]
    }, (error, result) => {
      if (error) return reject(new HttpError(502, "Cloudinary could not upload this image."));
      if (!result?.secure_url || !result?.public_id) {
        return reject(new HttpError(502, "Cloudinary returned an incomplete upload result."));
      }
      resolve({ url: result.secure_url, publicId: result.public_id });
    });
    stream.end(buffer);
  });
}

export async function deleteImage(publicId) {
  ensureCloudinaryConfigured();
  const result = await cloudinary.uploader.destroy(publicId, { resource_type: "image", invalidate: true });
  if (!["ok", "not found"].includes(result.result)) {
    throw new Error(`Cloudinary did not confirm image deletion (${result.result || "unknown result"}).`);
  }
}

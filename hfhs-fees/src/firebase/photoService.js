// photoService.js
// Real Firebase Storage uploads for student images.

import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import app from "./config";

const storage = getStorage(app);

export const PHOTO_SLOTS = {
  photo: "photo",
  aadhaarStudent: "aadhaar-student",
  aadhaarFather: "aadhaar-father",
  aadhaarMother: "aadhaar-mother",
};

export function fieldForSlot(slot) {
  const map = {
    photo: "photoUrl",
    "aadhaar-student": "aadhaarStudentPhotoUrl",
    "aadhaar-father": "aadhaarFatherPhotoUrl",
    "aadhaar-mother": "aadhaarMotherPhotoUrl",
  };
  return map[slot] || null;
}

/**
 * Compresses an image file to a JPEG under ~1 MB, max dimension 1600px.
 * Returns a new File. If the file is already small, returns it unchanged.
 */
async function compressImage(file, maxDim = 1600, quality = 0.85) {
  if (!file.type || !file.type.startsWith("image/")) return file;
  if (file.type === "image/jpeg" && file.size < 1_000_000) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, w, h);

    const blob = await new Promise((res) =>
      canvas.toBlob((b) => res(b), "image/jpeg", quality)
    );
    if (!blob) return file;

    const baseName = (file.name || "image").replace(/\.[^.]+$/, "");
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
  } catch (err) {
    console.warn("compressImage failed, uploading original:", err.message);
    return file;
  }
}

/**
 * Uploads a student image for a given slot.
 * Returns the public download URL.
 */
export async function uploadStudentImage(studentId, slot, file) {
  if (!studentId) throw new Error("Missing studentId.");
  if (!file) throw new Error("No file provided.");

  const compressed = await compressImage(file);

  const path = `student-images/${studentId}/${slot}`;
  const storageRef = ref(storage, path);

  await uploadBytes(storageRef, compressed, {
    contentType: compressed.type || "image/jpeg",
  });

  const url = await getDownloadURL(storageRef);
  return url;
}

export const uploadStudentPhoto = (studentId, file) =>
  uploadStudentImage(studentId, "photo", file);

export async function deleteStudentImage(studentId, slot) {
  if (!studentId || !slot) return;
  try {
    const storageRef = ref(storage, `student-images/${studentId}/${slot}`);
    await deleteObject(storageRef);
  } catch (err) {
    console.warn(`deleteStudentImage: ${slot} — ${err.message}`);
  }
}

export async function deleteStudentPhoto(studentId) {
  await Promise.all([
    deleteStudentImage(studentId, "photo"),
    deleteStudentImage(studentId, "aadhaar-student"),
    deleteStudentImage(studentId, "aadhaar-father"),
    deleteStudentImage(studentId, "aadhaar-mother"),
  ]);
}

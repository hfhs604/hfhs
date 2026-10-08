// photoService.js
// Stub — Firebase Storage is not yet enabled. Uploads are disabled.
// To enable, replace this file with the full version that uses getStorage(),
// uploadBytes(), and getDownloadURL() from "firebase/storage".

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

export async function uploadStudentImage() {
  throw new Error("Photo uploads are not enabled yet. Enable Firebase Storage first.");
}

export const uploadStudentPhoto = (studentId, file) =>
  uploadStudentImage(studentId, "photo", file);

export async function deleteStudentImage() {
  throw new Error("Photo uploads are not enabled yet.");
}

export async function deleteStudentPhoto() {
  throw new Error("Photo uploads are not enabled yet.");
}

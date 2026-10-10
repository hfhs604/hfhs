import React, { useEffect, useState } from "react";
import {
  createStudent,
  searchStudents,
  peekNextAdmissionNumber,
  reserveAdmissionNumber,
  updateStudentProfile,
  deleteStudentCompletely,
  updateStudentFull,
} from "../firebase/feeService";
import { getAllStudents } from "../firebase/reportsService";
import { uploadStudentImage } from "../firebase/photoService";
import StudentPrintPage from "./StudentPrintPage";
import BlankAdmissionForm from "./BlankAdmissionForm";
import CameraCapture from "./CameraCapture";
import PrintManager from "./PrintManager";
import "../styles/feeManagement.css";

const CLASS_OPTIONS = [
  "Pre-LKG", "NUR", "LKG", "UKG",
  "I", "II", "III", "IV", "V",
  "VI", "VII", "VIII", "IX", "X",
];

const emptyForm = {
  admissionNumber: "", rollNumber: "", name: "", className: "", section: "",
  dateOfAdmission: "", dateOfBirth: "", gender: "", bloodGroup: "", penNumber: "",
  fatherName: "", motherName: "", guardianName: "",
  fatherOccupation: "", motherOccupation: "",
  fatherMobile: "", motherMobile: "", mobileNumber: "",
  addressPresent: "", addressPermanent: "",
  aadhaarStudent: "", aadhaarFather: "", aadhaarMother: "",
  nationality: "Indian", category: "", religion: "", lastInstitution: "",
  docAadhaarStudent: false, docAadhaarFather: false, docAadhaarMother: false,
  docPhoto: false, docTransferCertificate: false, docBirthCertificate: false,
  remarks: "",
};

const IMAGE_SLOTS = [
  { slot: "photo",           field: "photoUrl",                label: "Student Photo",     camera: true },
  { slot: "aadhaar-student", field: "aadhaarStudentPhotoUrl",  label: "Aadhaar — Student", camera: true },
  { slot: "aadhaar-father",  field: "aadhaarFatherPhotoUrl",   label: "Aadhaar — Father",  camera: true },
  { slot: "aadhaar-mother",  field: "aadhaarMotherPhotoUrl",   label: "Aadhaar — Mother",  camera: true },
];

const EDIT_ROLES = ["superAdmin", "admin", "accountant"];
const DELETE_ROLES = ["superAdmin"];

export default function StudentDirectory({ session, onSelectStudent, role }) {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [sameAsPresent, setSameAsPresent] = useState(false);
  const [printStudent, setPrintStudent] = useState(null);
  const [showBlankForm, setShowBlankForm] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(null);
  const [deleteMsg, setDeleteMsg] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [cameraSlot, setCameraSlot] = useState(null);

  const [editStudent, setEditStudent] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [editSameAsPresent, setEditSameAsPresent] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState(null);
  const [editCameraSlot, setEditCameraSlot] = useState(null);

  const [images, setImages] = useState({
    photo: { file: null, preview: null },
    "aadhaar-student": { file: null, preview: null },
    "aadhaar-father": { file: null, preview: null },
    "aadhaar-mother": { file: null, preview: null },
  });

  const [editImages, setEditImages] = useState({
    photo: { file: null, preview: null },
    "aadhaar-student": { file: null, preview: null },
    "aadhaar-father": { file: null, preview: null },
    "aadhaar-mother": { file: null, preview: null },
  });

  const canEdit = EDIT_ROLES.includes(role);
  const canDelete = DELETE_ROLES.includes(role);

  async function loadStudents() {
    setLoading(true);
    try {
      const list = await getAllStudents({ session });
      setStudents(list);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStudents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    if (!showForm) return;
    (async () => {
      try {
        const next = await peekNextAdmissionNumber();
        setForm((f) =>
          f.admissionNumber ? f : { ...f, admissionNumber: String(next) }
        );
      } catch (e) {
        console.warn("Could not peek next admission number:", e.message);
      }
    })();
  }, [showForm]);

  useEffect(() => {
    if (!sameAsPresent) return;
    setForm((f) => ({ ...f, addressPermanent: f.addressPresent }));
  }, [sameAsPresent, form.addressPresent]);

  useEffect(() => {
    if (!editSameAsPresent) return;
    setEditForm((f) => ({ ...f, addressPermanent: f.addressPresent }));
  }, [editSameAsPresent, editForm.addressPresent]);

  async function handleSearch(e) {
    e.preventDefault();
    if (!searchTerm.trim()) return loadStudents();
    setLoading(true);
    try {
      setStudents(await searchStudents(searchTerm.trim()));
    } finally {
      setLoading(false);
    }
  }

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function updateEdit(field, value) {
    setEditForm((f) => ({ ...f, [field]: value }));
  }

  function setImageForSlot(slot, file, mode = "add") {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (mode === "edit") {
        setEditImages((prev) => ({
          ...prev,
          [slot]: { file, preview: ev.target.result },
        }));
      } else {
        setImages((prev) => ({
          ...prev,
          [slot]: { file, preview: ev.target.result },
        }));
      }
    };
    reader.readAsDataURL(file);
  }

  function resetForm() {
    setForm(emptyForm);
    setSameAsPresent(false);
    setImages({
      photo: { file: null, preview: null },
      "aadhaar-student": { file: null, preview: null },
      "aadhaar-father": { file: null, preview: null },
      "aadhaar-mother": { file: null, preview: null },
    });
  }

  function openEdit(student) {
    if (!canEdit) return;
    setEditStudent(student);
    setEditError(null);

    const populated = {};
    Object.keys(emptyForm).forEach((k) => {
      const v = student[k];
      if (k.startsWith("doc") && typeof v === "boolean") {
        populated[k] = v;
      } else if (Array.isArray(v)) {
        populated[k] = v;
      } else {
        populated[k] = v ?? "";
      }
    });
    if (Array.isArray(student.documentsSubmitted)) {
      populated.docAadhaarStudent = student.documentsSubmitted.includes("Aadhaar - Student");
      populated.docAadhaarFather = student.documentsSubmitted.includes("Aadhaar - Father");
      populated.docAadhaarMother = student.documentsSubmitted.includes("A

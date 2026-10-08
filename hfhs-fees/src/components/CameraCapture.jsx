import React, { useEffect, useRef, useState } from "react";
import "../styles/feeManagement.css";

/**
 * CameraCapture
 * Modal that offers "Use Camera" (webcam, works on desktop + mobile)
 * or "Upload File" (normal file picker).
 *
 * Props:
 *   label      — display name (e.g. "Student Photo")
 *   onCapture  — callback(File) with the resulting image file
 *   onClose    — callback() to close the modal
 */
export default function CameraCapture({ label, onCapture, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [mode, setMode] = useState("choose"); // choose | camera | preview
  const [error, setError] = useState(null);
  const [capturedBlob, setCapturedBlob] = useState(null);
  const [capturedUrl, setCapturedUrl] = useState(null);

  // Start/stop webcam when mode changes
  useEffect(() => {
    if (mode !== "camera") return;

    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (err) {
        if (cancelled) return;
        console.warn("Camera access failed:", err);
        setError(
          err?.name === "NotAllowedError"
            ? "Camera permission denied. Please allow camera access in your browser and try again."
            : err?.name === "NotFoundError"
            ? "No camera found on this device."
            : `Camera error: ${err.message}`
        );
      }
    })();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [mode]);

  async function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    // Draw current frame to canvas
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError("Could not capture image. Try again.");
          return;
        }
        setCapturedBlob(blob);
        setCapturedUrl(URL.createObjectURL(blob));
        setMode("preview");
      },
      "image/jpeg",
      0.92
    );
  }

  function retake() {
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    setCapturedBlob(null);
    setCapturedUrl(null);
    setMode("camera");
  }

  function usePhoto() {
    if (!capturedBlob) return;
    const file = new File([capturedBlob], `capture-${Date.now()}.jpg`, {
      type: "image/jpeg",
    });
    onCapture(file);
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    onClose();
  }

  function uploadFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    onCapture(f);
    onClose();
  }

  return (
    <div className="fm-modal-overlay" style={{ zIndex: 9500 }}>
      <div className="fm-modal" style={{ maxWidth: 540 }}>
        <h3>Add {label}</h3>

        {/* ---------- MODE: CHOOSE ---------- */}
        {mode === "choose" && (
          <>
            <p style={{ margin: "12px 0", fontSize: 14, color: "#4b5563" }}>
              Take a photo with your device's camera, or upload an existing image file.
            </p>
            <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
              <button
                type="button"
                className="fm-primary-btn"
                onClick={() => {
                  setError(null);
                  setMode("camera");
                }}
                style={{ flex: 1 }}
              >
                📷 Use Camera
              </button>
              <label
                className="fm-secondary-btn"
                style={{ flex: 1, textAlign: "center", cursor: "pointer" }}
              >
                📁 Upload File
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={uploadFile}
                />
              </label>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button type="button" className="fm-secondary-btn" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}

        {/* ---------- MODE: CAMERA ---------- */}
        {mode === "camera" && (
          <>
            {error ? (
              <div style={{ padding: 16, background: "#fdecec", borderRadius: 6, margin: "12px 0" }}>
                <p style={{ margin: 0, color: "#c62828", fontSize: 13 }}>
                  ❌ {error}
                </p>
                <p style={{ margin: "8px 0 0", fontSize: 12, color: "#6b7280" }}>
                  You can still use the "Upload File" option below.
                </p>
              </div>
            ) : (
              <div
                style={{
                  margin: "12px 0",
                  background: "#000",
                  borderRadius: 8,
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  style={{ width: "100%", display: "block", maxHeight: 380, objectFit: "cover" }}
                />
              </div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "space-between", marginTop: 12 }}>
              <button
                type="button"
                className="fm-secondary-btn"
                onClick={() => setMode("choose")}
              >
                ← Back
              </button>
              {!error && (
                <button
                  type="button"
                  className="fm-primary-btn"
                  onClick={capture}
                >
                  📸 Capture Photo
                </button>
              )}
            </div>
          </>
        )}

        {/* ---------- MODE: PREVIEW ---------- */}
        {mode === "preview" && (
          <>
            <p style={{ margin: "12px 0", fontSize: 14, color: "#4b5563" }}>
              Preview — click "Use Photo" to attach, or "Retake" to try again.
            </p>
            <div
              style={{
                background: "#000",
                borderRadius: 8,
                overflow: "hidden",
                marginBottom: 12,
              }}
            >
              <img
                src={capturedUrl}
                alt="Captured"
                style={{ width: "100%", display: "block", maxHeight: 380, objectFit: "contain" }}
              />
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" className="fm-secondary-btn" onClick={retake}>
                🔄 Retake
              </button>
              <button type="button" className="fm-primary-btn" onClick={usePhoto}>
                ✓ Use Photo
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

"use client";

import { Check, X } from "lucide-react";
import {
  type FormEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

export const MASTER_PIN_SESSION_KEY = "star-wallet-master-pin-v1";

type PinStep = "verify" | "setup" | "complete";
type PinCredential = { version: 1; salt: string; digest: string };

export function hasMasterPinCredential(): boolean {
  return readPinCredential() !== null;
}

export function MasterPinSheet({
  alreadySet,
  onClose,
  onSaved,
  verifyOnly = false,
  onVerified,
  purpose = "profile",
}: {
  alreadySet: boolean;
  onClose: () => void;
  onSaved: () => void;
  verifyOnly?: boolean;
  onVerified?: () => void;
  purpose?: "profile" | "passkey";
}) {
  const passkeyHandoff = purpose === "passkey";
  const [step, setStep] = useState<PinStep>(
    alreadySet || passkeyHandoff ? "verify" : "setup",
  );
  const [currentPin, setCurrentPin] = useState("");
  const [pin, setPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const currentInputRef = useRef<HTMLInputElement>(null);
  const newPinInputRef = useRef<HTMLInputElement>(null);
  const active = useRef(true);
  const pending = useRef(false);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const close = () => {
    active.current = false;
    onClose();
  };

  useEffect(() => {
    const focusFrame = window.requestAnimationFrame(() => {
      if (step === "verify") currentInputRef.current?.focus();
      if (step === "setup") newPinInputRef.current?.focus();
    });

    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        active.current = false;
        onClose();
      }
    };

    document.addEventListener("keydown", closeWithEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [onClose, step]);

  const verifyCurrentPin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending.current || !active.current || currentPin.length !== 4) return;

    pending.current = true;
    setSaving(true);
    try {
      const valid = await verifyPinCredential(currentPin);
      if (!active.current) return;
      if (!valid) {
        setError("Incorrect PIN.");
        return;
      }

      if (verifyOnly || passkeyHandoff) {
        onVerified?.();
        onClose();
        return;
      }

      setCurrentPin("");
      setError("");
      setStep("setup");
    } catch {
      setError("Unable to verify the PIN on this device.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  const savePin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (passkeyHandoff || pending.current || !active.current) return;

    if (pin.length !== 4) {
      setError("Enter a 4-digit PIN.");
      return;
    }

    if (pin !== confirmation) {
      setError("The PINs do not match.");
      return;
    }

    pending.current = true;
    setSaving(true);
    try {
      const credential = await createPinCredential(pin);
      if (!active.current) return;
      window.localStorage.setItem(MASTER_PIN_SESSION_KEY, credential);
      window.sessionStorage.removeItem(MASTER_PIN_SESSION_KEY);
      onSaved();
      if (verifyOnly) {
        onVerified?.();
        onClose();
        return;
      }
      setStep("complete");
    } catch {
      setError("Unable to save the PIN on this device.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  return (
    <>
      <button
        className={`add-funds-backdrop ${passkeyHandoff ? "parent-attention-backdrop" : ""}`}
        type="button"
        aria-label="Close master PIN"
        onClick={close}
      />
      <section
        className={`add-funds-sheet master-pin-sheet ${passkeyHandoff ? "parent-attention-sheet" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="master-pin-title"
      >
        <header className="add-funds-sheet-header">
          <span aria-hidden="true" />
          <h2 id="master-pin-title">
            {passkeyHandoff
              ? "Master PIN"
              : verifyOnly && alreadySet
                ? "Enter PIN"
                : alreadySet
                  ? "Reset PIN"
                  : "Create PIN"}
          </h2>
          <button type="button" aria-label="Close master PIN" onClick={close}>
            <X size={19} />
          </button>
        </header>

        {passkeyHandoff && !alreadySet ? (
          <div className="master-pin-unavailable">
            <p role="alert">
              No master PIN is set up on this device. Ask your parent to set it
              up in their profile, then try again.
            </p>
            <button
              className="filled-action-button full-width-action"
              type="button"
              onClick={close}
            >
              Not now
            </button>
          </div>
        ) : step === "complete" ? (
          <div className="master-pin-complete">
            <span aria-hidden="true">
              <Check size={22} strokeWidth={2.5} />
            </span>
            <strong>{alreadySet ? "PIN reset" : "PIN created"}</strong>
            <button
              className="filled-action-button full-width-action"
              type="button"
              onClick={close}
            >
              Done
            </button>
          </div>
        ) : step === "verify" ? (
          <form className="master-pin-form" onSubmit={verifyCurrentPin}>
            <p>
              {passkeyHandoff
                ? "Enter the master PIN to continue to passkey verification."
                : verifyOnly
                  ? "Enter the master PIN to switch to the parent profile."
                  : "Enter your current PIN before choosing a new one."}
            </p>
            <PinTrailField
              label="Current PIN"
              value={currentPin}
              onChange={(value) => {
                setCurrentPin(value);
                setError("");
              }}
              inputRef={currentInputRef}
              errorId={error ? "master-pin-error" : undefined}
            />
            <PinError message={error} />
            <button
              className="filled-action-button full-width-action master-pin-submit"
              type="submit"
              disabled={saving || currentPin.length !== 4}
            >
              {saving
                ? "Checking…"
                : passkeyHandoff
                  ? "Continue"
                  : verifyOnly
                    ? "Switch to parent"
                    : "Continue"}
            </button>
          </form>
        ) : (
          <form className="master-pin-form" onSubmit={savePin}>
            <p>
              {alreadySet
                ? "Choose a new PIN for switching between profiles."
                : verifyOnly
                  ? "Create a PIN before switching to the parent profile."
                  : "Create a PIN for switching between parent and child profiles."}
            </p>
            <PinTrailField
              label="New PIN"
              value={pin}
              onChange={(value) => {
                setPin(value);
                setError("");
              }}
              inputRef={newPinInputRef}
              errorId={error ? "master-pin-error" : undefined}
            />
            <PinTrailField
              label="Confirm PIN"
              value={confirmation}
              onChange={(value) => {
                setConfirmation(value);
                setError("");
              }}
              errorId={error ? "master-pin-error" : undefined}
            />
            <PinError message={error} />
            <button
              className="filled-action-button full-width-action master-pin-submit"
              type="submit"
              disabled={saving || pin.length !== 4 || confirmation.length !== 4}
            >
              {saving ? "Saving…" : alreadySet ? "Reset PIN" : "Create PIN"}
            </button>
          </form>
        )}
      </section>
    </>
  );
}

function PinTrailField({
  label,
  value,
  onChange,
  inputRef,
  errorId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  errorId?: string;
}) {
  const [showLastDigit, setShowLastDigit] = useState(false);
  const revealTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (revealTimerRef.current !== null) {
        window.clearTimeout(revealTimerRef.current);
      }
    },
    [],
  );

  const updateValue = (nextValue: string) => {
    const normalizedValue = normalizePin(nextValue);
    onChange(normalizedValue);
    setShowLastDigit(Boolean(normalizedValue));

    if (revealTimerRef.current !== null) {
      window.clearTimeout(revealTimerRef.current);
    }
    if (normalizedValue) {
      revealTimerRef.current = window.setTimeout(
        () => setShowLastDigit(false),
        1_500,
      );
    }
  };

  return (
    <label>
      <span>{label}</span>
      <span className="master-pin-field">
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          value={value}
          onChange={(event) => updateValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Backspace") return;
            event.preventDefault();
            updateValue(value.slice(0, -1));
          }}
          onBeforeInput={(event) => {
            const inputEvent = event.nativeEvent as InputEvent;
            if (inputEvent.inputType !== "deleteContentBackward") return;
            event.preventDefault();
            updateValue(value.slice(0, -1));
          }}
          onFocus={(event) => {
            event.currentTarget.setSelectionRange(value.length, value.length);
          }}
          onClick={(event) => {
            event.currentTarget.setSelectionRange(value.length, value.length);
          }}
          aria-label={label}
          aria-describedby={errorId}
        />
        <span
          className={`master-pin-trail ${value ? "" : "is-empty"}`}
          aria-hidden="true"
        >
          {formatPinTrail(value, showLastDigit)}
        </span>
      </span>
    </label>
  );
}

function PinError({ message }: { message: string }) {
  if (!message) return null;

  return (
    <p className="master-pin-error" id="master-pin-error" role="alert">
      {message}
    </p>
  );
}

function normalizePin(value: string): string {
  return value.replace(/\D/g, "").slice(0, 4);
}

function formatPinTrail(value: string, revealLastDigit: boolean): string {
  if (!value) return "••••";
  if (!revealLastDigit) return "•".repeat(value.length);
  return `${"•".repeat(value.length - 1)}${value.at(-1)}`;
}

async function createPinCredential(pin: string): Promise<string> {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const digest = await derivePinDigest(pin, salt);

  return JSON.stringify({
    version: 1,
    salt: toBase64(salt),
    digest: toBase64(digest),
  });
}

export async function verifyPinCredential(pin: string): Promise<boolean> {
  const credential = readPinCredential();
  if (!credential) return false;

  try {
    const actualDigest = await derivePinDigest(
      pin,
      fromBase64(credential.salt),
    );
    return equalBytes(actualDigest, fromBase64(credential.digest));
  } catch {
    return false;
  }
}

function readPinCredential(): PinCredential | null {
  try {
    if (typeof window === "undefined") return null;
    const storedValue =
      window.localStorage.getItem(MASTER_PIN_SESSION_KEY) ??
      window.sessionStorage.getItem(MASTER_PIN_SESSION_KEY);
    if (!storedValue) return null;
    const credential = JSON.parse(storedValue) as Partial<PinCredential>;
    if (
      credential.version !== 1 ||
      typeof credential.salt !== "string" ||
      !credential.salt ||
      typeof credential.digest !== "string" ||
      !credential.digest
    ) {
      return null;
    }
    // Preserve an existing PIN from the previous tab-only implementation.
    window.localStorage.setItem(MASTER_PIN_SESSION_KEY, storedValue);
    return credential as PinCredential;
  } catch {
    return null;
  }
}

async function derivePinDigest(
  pin: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  const saltBuffer = new ArrayBuffer(salt.byteLength);
  new Uint8Array(saltBuffer).set(salt);
  const source = await window.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const digest = await window.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBuffer,
      iterations: 100_000,
    },
    source,
    256,
  );

  return new Uint8Array(digest);
}

function equalBytes(first: Uint8Array, second: Uint8Array): boolean {
  if (first.length !== second.length) return false;

  let difference = 0;
  for (let index = 0; index < first.length; index += 1) {
    difference |= first[index] ^ second[index];
  }
  return difference === 0;
}

function toBase64(bytes: Uint8Array): string {
  let value = "";
  bytes.forEach((byte) => {
    value += String.fromCharCode(byte);
  });
  return window.btoa(value);
}

function fromBase64(value: string): Uint8Array {
  const binary = window.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

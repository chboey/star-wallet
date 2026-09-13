import Image from "next/image";

export function ParentAttentionContent({
  onContinue,
}: {
  onContinue: () => void;
}) {
  return (
    <div className="parent-attention-content">
      <Image
        className="parent-attention-illustration"
        src="/illustrations/profile/exclaimation_mark.png"
        alt="An Exclaimation Mark"
        width={180}
        height={225}
      />
      <h3>Your parent&apos;s attention is needed</h3>
      <p>
        Ask your parent to enter the master PIN, then use their passkey to
        approve this device. Access stays available until your parent revokes
        it.
      </p>
      <button
        className="filled-action-button parent-attention-continue"
        type="button"
        onClick={onContinue}
      >
        Continue
      </button>
    </div>
  );
}

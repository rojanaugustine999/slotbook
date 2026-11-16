import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

// Built on the browser's own <dialog> element. Opening it with showModal() gives us,
// for free: a dimmed backdrop, focus kept inside the dialog, Escape to close, and
// the page behind it made inert for screen readers. Less code, and fewer bugs than
// a hand-made modal.
export function Dialog({ open, onClose, title, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose} // fires on Escape too
      onClick={(event) => {
        if (event.target === ref.current) onClose(); // a click on the dimmed backdrop
      }}
      aria-labelledby="dialog-title"
      className="m-auto w-[min(92vw,26rem)] rounded-card border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/40"
    >
      {open && (
        <div className="p-6">
          <h2 id="dialog-title" className="text-lg font-medium">
            {title}
          </h2>
          <div className="mt-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}

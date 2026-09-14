import { useEffect, useRef, useCallback, useId } from 'react';

/**
 * Gemeinsame Dialoghülle.
 *
 * Löst die Barrierefreiheit an EINER Stelle für alle fünf Dialoge. Zuvor reagierte
 * nur das Sensor-Panel auf Escape, kein Dialog trug `role="dialog"`, und der
 * Tastaturfokus konnte den geöffneten Dialog verlassen — für ein Gerät, das
 * dauerhaft im Werk hängt und auch per Tastatur bedient wird, ein echter Mangel.
 *
 * Enthalten sind: role/aria-modal, Beschriftung über aria-labelledby, Schließen per
 * Escape, Fokusfalle, Fokusrückgabe an das auslösende Element und das Sperren des
 * Hintergrund-Scrollens.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({ title, onClose, children, className = '', labelledBy }) {
  const dialogRef = useRef(null);
  const previouslyFocused = useRef(null);
  // useId statt einer Zufallszahl: stabil über Renderzyklen hinweg und ohne
  // Seiteneffekt während des Renderns.
  const generatedId = useId();

  const headingId = labelledBy ?? generatedId;

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      // Fokusfalle: Tab am Ende springt an den Anfang und umgekehrt.
      const focusable = dialogRef.current?.querySelectorAll(FOCUSABLE);
      if (!focusable?.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    previouslyFocused.current = document.activeElement;

    // Erstes bedienbares Element fokussieren, damit die Tastaturbedienung im
    // Dialog beginnt und nicht dahinter.
    const focusable = dialogRef.current?.querySelector(FOCUSABLE);
    (focusable ?? dialogRef.current)?.focus();

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = overflow;
      // Fokus dorthin zurückgeben, wo er herkam.
      previouslyFocused.current?.focus?.();
    };
  }, []);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        className={`glass-card ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="modal-header">
          <h2 className="modal-title" id={headingId}>
            {title}
          </h2>
          <button className="modal-close" onClick={onClose} aria-label="Dialog schließen" type="button">
            <span aria-hidden="true">&times;</span>
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}

"""Vertrauenswürdigkeit der Uhrzeit.

Ein Raspberry Pi hat **keine batteriegepufferte Echtzeituhr**. Nach einem
Stromausfall bootet er mit einem willkürlichen Datum und übernimmt die richtige Zeit
erst, wenn NTP durchkommt. Fällt gleichzeitig das Netz aus — der wahrscheinlichste
gemeinsame Fall — misst und stempelt er weiter, mit falscher Zeit.

Das ist hier kein Schönheitsfehler. Der Zeitstempel trägt drei Dinge:

* **Idempotenz** — er ist Teil des Schlüssels ``(sensor_uuid, quantity, time)``
* **Schwellenwert-Auswahl** — der Server sucht damit, welche Grenze *damals* galt
* **Reports** — die Zeitraum-Auswahl im Audit-Report beruht vollständig darauf

Die Lösung hier hat zwei Stufen:

1. **Nicht senden, was man nicht verantworten kann.** Solange die Uhr nicht
   vertrauenswürdig ist, wandern Messungen in den Puffer, aber nicht auf die Leitung.
2. **Nachträglich berichtigen.** Zu jeder Messung wird der Wert der *monotonen* Uhr
   festgehalten. Wird die Wanduhr später vertrauenswürdig, lässt sich daraus der
   wahre Zeitpunkt jeder gepufferten Messung berechnen — solange der Prozess
   zwischenzeitlich nicht neu gestartet wurde.

Überlebt ein Neustart die untrusted-Phase, sind diese Messungen nicht mehr
korrigierbar. Sie werden dann in Quarantäne gestellt statt mit falscher Zeit
versendet.
"""

from __future__ import annotations

import logging
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

log = logging.getLogger(__name__)

#: Ist die Wanduhr vor diesem Datum, kann sie nicht stimmen (Pi ohne RTC startet
#: typischerweise in der Vergangenheit).
_PLAUSIBEL_AB = datetime(2025, 1, 1, tzinfo=timezone.utc)

_TIMEDATECTL_TIMEOUT_S = 3.0


def ntp_synchronisiert() -> bool | None:
    """Fragt systemd, ob die Uhr per NTP gesetzt wurde.

    :returns: ``True``/``False`` oder ``None``, wenn sich das nicht feststellen
              lässt (kein systemd, ``timedatectl`` nicht vorhanden).
    """
    try:
        ergebnis = subprocess.run(
            ["timedatectl", "show", "-p", "NTPSynchronized", "--value"],
            capture_output=True,
            text=True,
            timeout=_TIMEDATECTL_TIMEOUT_S,
            check=False,
        )
    except (FileNotFoundError, subprocess.SubprocessError) as fehler:
        log.debug("timedatectl nicht verfügbar: %s", fehler)
        return None

    if ergebnis.returncode != 0:
        return None
    return ergebnis.stdout.strip().lower() == "yes"


@dataclass(slots=True)
class ClockStatus:
    trusted: bool
    grund: str


class ClockGuard:
    """Hält fest, ob der Uhrzeit getraut werden darf, und berichtigt Zeitstempel.

    :param require_sync: ``False`` setzen, wenn ein RTC-Modul verbaut ist — dann ist
                         die Uhr auch ohne Netz vertrauenswürdig.
    :param recheck_s: Abstand zwischen zwei Prüfungen. Die Prüfung startet einen
                      Unterprozess; sie gehört nicht in jeden Messzyklus.
    """

    def __init__(self, *, require_sync: bool, recheck_s: float) -> None:
        self._require_sync = require_sync
        self._recheck_s = recheck_s
        self._letzte_pruefung_mono = float("-inf")
        self._status = ClockStatus(trusted=not require_sync, grund="Prüfung deaktiviert")
        self._wurde_je_vertrauenswuerdig = not require_sync

    # ── Zustand ────────────────────────────────────────────────────────

    @property
    def status(self) -> ClockStatus:
        return self._status

    @property
    def trusted(self) -> bool:
        return self._status.trusted

    def pruefe(self) -> ClockStatus:
        """Prüft die Uhr, höchstens alle ``recheck_s`` Sekunden."""
        jetzt_mono = time.monotonic()
        if jetzt_mono - self._letzte_pruefung_mono < self._recheck_s:
            return self._status

        self._letzte_pruefung_mono = jetzt_mono
        vorher = self._status.trusted
        self._status = self._ermittle_status()

        if self._status.trusted and not vorher:
            log.info("Uhrzeit ist jetzt vertrauenswürdig (%s)", self._status.grund)
            self._wurde_je_vertrauenswuerdig = True
        elif not self._status.trusted and vorher:
            log.warning("Uhrzeit NICHT mehr vertrauenswürdig (%s)", self._status.grund)

        return self._status

    def _ermittle_status(self) -> ClockStatus:
        if not self._require_sync:
            return ClockStatus(True, "Prüfung deaktiviert (RTC angenommen)")

        jetzt = datetime.now(timezone.utc)
        if jetzt < _PLAUSIBEL_AB:
            return ClockStatus(False, f"Systemzeit {jetzt.isoformat()} liegt vor {_PLAUSIBEL_AB.date()}")

        synchron = ntp_synchronisiert()
        if synchron is None:
            # Ohne systemd lässt sich nur die Plausibilität prüfen. Das ist schwächer,
            # aber besser als blindes Vertrauen — und es wird protokolliert.
            return ClockStatus(True, "timedatectl nicht verfügbar, Datum plausibel")
        if not synchron:
            return ClockStatus(False, "NTP nicht synchronisiert")
        return ClockStatus(True, "NTP synchronisiert")

    # ── Zeitstempel ────────────────────────────────────────────────────

    def jetzt(self) -> tuple[datetime, float, bool]:
        """Liefert Wanduhr, monotone Uhr und die Vertrauenswürdigkeit — in einem Zug.

        Die drei Werte gehören zusammen und dürfen nicht einzeln erhoben werden,
        sonst passen sie im Grenzfall nicht zueinander.
        """
        return datetime.now(timezone.utc), time.monotonic(), self._status.trusted

    def korrigiere(self, monotonic_s: float) -> datetime | None:
        """Berechnet den wahren Zeitpunkt einer Messung aus ihrer monotonen Marke.

        Nur gültig innerhalb derselben Prozesslebensdauer — die monotone Uhr beginnt
        bei jedem Start neu.

        :returns: Der berichtigte Zeitpunkt oder ``None``, wenn keine Korrektur
                  möglich ist.
        """
        if not self._status.trusted:
            return None

        jetzt_wand = datetime.now(timezone.utc)
        jetzt_mono = time.monotonic()
        alter_s = jetzt_mono - monotonic_s
        if alter_s < 0:
            # Kann nur bei einem Programmierfehler auftreten; kein stiller Unsinn.
            log.warning("Monotone Marke liegt in der Zukunft (%.3f s) — keine Korrektur", alter_s)
            return None

        return jetzt_wand - timedelta(seconds=alter_s)

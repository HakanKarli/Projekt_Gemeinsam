/**
 * Barrierefreiheit der Dialoghülle.
 *
 * Diese Zusicherungen halten fest, was zuvor in keinem der fünf Dialoge vorhanden
 * war: eine erkennbare Rolle, eine Beschriftung, Schließen per Escape und ein
 * Fokus, der den Dialog nicht verlassen kann.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Modal from '../src/components/Modal';

function renderModal(props = {}) {
  const onClose = vi.fn();
  render(
    <Modal title="Testdialog" onClose={onClose} {...props}>
      <button type="button">Erster</button>
      <button type="button">Zweiter</button>
    </Modal>,
  );
  return { onClose };
}

describe('Modal', () => {
  it('ist als Dialog erkennbar und beschriftet', () => {
    renderModal();

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    // Die Beschriftung verweist auf die Überschrift des Dialogs.
    const headingId = dialog.getAttribute('aria-labelledby');
    expect(headingId).toBeTruthy();
    expect(document.getElementById(headingId)?.textContent).toBe('Testdialog');
  });

  it('schließt bei Escape', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('bietet eine beschriftete Schließen-Schaltfläche', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await user.click(screen.getByRole('button', { name: 'Dialog schließen' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('setzt den Fokus in den Dialog', () => {
    renderModal();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dialog schließen' }));
  });

  it('hält den Fokus im Dialog fest', async () => {
    const user = userEvent.setup();
    renderModal();

    const focusable = screen.getAllByRole('button');
    const last = focusable[focusable.length - 1];
    last.focus();

    await user.tab();

    // Nach dem letzten Element geht es wieder von vorn los, nicht in den Hintergrund.
    expect(document.activeElement).toBe(focusable[0]);
  });

  it('sperrt das Scrollen im Hintergrund und gibt es wieder frei', () => {
    const { unmount } = render(
      <Modal title="Test" onClose={() => {}}>
        <span>Inhalt</span>
      </Modal>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});

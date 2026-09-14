import React from 'react';

/**
 * Fängt Fehler eines einzelnen Panels ab.
 *
 * Ohne diese Grenze nimmt ein Fehler in einem Chart in React 19 den kompletten Baum
 * mit — statt eines defekten Kanals steht dann die ganze Anzeige still. Für ein
 * Gerät, das dauerhaft im Werk hängt, ist das der Unterschied zwischen "ein Kanal
 * fehlt" und "das Dashboard ist tot".
 *
 * Bewusst als Klasse: Fehlergrenzen sind die einzige Stelle, an der React keine
 * Funktionskomponenten unterstützt.
 */
export default class PanelBoundary extends React.Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    console.error('[Panel]', this.props.label ?? '', error, info?.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="sensor-panel glass-card sp-error" role="alert">
        <span className="sp-error-title">Panel konnte nicht dargestellt werden</span>
        {this.props.label && <span className="sp-error-label">{this.props.label}</span>}
        <button className="btn btn-ghost btn-sm" onClick={() => this.setState({ failed: false })}>
          Erneut versuchen
        </button>
      </div>
    );
  }
}
